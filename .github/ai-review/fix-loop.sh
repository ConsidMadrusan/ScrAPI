#!/usr/bin/env bash
# Fix loop for the AI code review. Called by .github/workflows/ai-fix.yml.
#
#   fix-loop.sh collect <reviews-dir> <output-file>
#     Writes the findings at or above FIX_MIN_SEVERITY from the review results
#     in <reviews-dir> (review-<name>.json) to <output-file> as a JSON array and
#     prints how many there are.
#
#   fix-loop.sh run <findings-file>
#     Repeats up to MAX_ITERATIONS times: fix the findings, commit, and review
#     the result again with the three review prompts. Stops early when no
#     findings at or above FIX_MIN_SEVERITY remain. Writes the pull request body
#     to ${WORK_DIR}/pr-body.md and the outputs `changed` and `check_passed` to
#     $GITHUB_OUTPUT.
#
# Needs BASE_REF, HEAD_REF, HEAD_SHA, PR_NUMBER, REPO, and WORK_DIR. Logs only
# statuses and counts, never review or code content.
set -euo pipefail

MAX_ITERATIONS="${MAX_ITERATIONS:-5}"
FIX_MIN_SEVERITY="${FIX_MIN_SEVERITY:-medium}"
REVIEWS=(architecture security quality)
PROMPT_DIR=".github/ai-review"
# Paths the fixer must not change. Its edits there are discarded.
PROTECTED_PATHS=(.github docs package.json package-lock.json)
REVIEW_TOOLS="Read,Grep,Glob,Bash(git diff *),Bash(git log *),Bash(git show *)"
FIX_TOOLS="Read,Grep,Glob,Edit,Write,Bash(npm run check),Bash(npm run lint),Bash(npm run typecheck),Bash(npm run test),Bash(npm run test *),Bash(git diff *),Bash(git status *)"

# The review prompts use different severity scales; this maps them onto one.
JQ_RANK='def rank: {"nit":0,"low":1,"minor":1,"medium":2,"high":3,"major":3,"critical":4,"blocker":4}[.] // 0;'

min_rank() {
  jq -nr --arg severity "${FIX_MIN_SEVERITY}" "${JQ_RANK}"' $severity | rank'
}

# collect_findings <reviews-dir> <output-file>
collect_findings() {
  local dir="$1" output="$2" review file
  local parts=()
  for review in "${REVIEWS[@]}"; do
    file="${dir}/review-${review}.json"
    [ -f "${file}" ] || continue
    parts+=("$(jq -c --arg review "${review}" --argjson min "$(min_rank)" "${JQ_RANK}"'
      [(.findings // [])[] | select((.severity | rank) >= $min) | . + {review: $review}]' "${file}")")
  done
  printf '%s\n' "${parts[@]}" '[]' | jq -s 'add' > "${output}"
  jq 'length' "${output}"
}

# run_claude <output-file> <prompt-file> <schema-file> <allowed-tools> <max-turns>
# Writes the structured output to <output-file>. Returns 1 and prints the stop
# reason when the run returned none.
run_claude() {
  local output="$1" prompt_file="$2" schema="$3" tools="$4" turns="$5"
  local raw="${output}.raw"
  claude --bare -p "$(cat "${prompt_file}")" \
    --output-format json \
    --json-schema "$(jq -c . "${schema}")" \
    --allowedTools "${tools}" \
    --permission-prompts none \
    --max-turns "${turns}" > "${raw}" 2> "${raw}.stderr" || true
  if jq -e '.structured_output | type == "object"' "${raw}" > /dev/null 2>&1; then
    jq '.structured_output' "${raw}" > "${output}"
    return 0
  fi
  if [ -s "${raw}" ] && jq -e 'type == "object"' "${raw}" > /dev/null 2>&1; then
    jq -r '"\(.subtype // "unknown") after \(.num_turns // "?") turns"' "${raw}"
  else
    echo "no result; Claude Code exited before writing one"
  fi
  return 1
}

# review_round <dir>: runs the three reviews in parallel on the current HEAD.
# Returns 1 when any review returned no result.
review_round() {
  local dir="$1" review prompt_file failed=0
  mkdir -p "${dir}"
  for review in "${REVIEWS[@]}"; do
    prompt_file="${dir}/${review}.prompt.md"
    {
      cat <<EOF
You are reviewing pull request #${PR_NUMBER} in ${REPO}. The working directory contains the pull request branch with automated fixes committed on top.
Get the changes with \`git diff origin/${BASE_REF}...HEAD\`.

EOF
      cat "${WORK_DIR}/review-rules.md"
      echo
      echo "Review task:"
      echo
      cat "${dir}/${review}.task.md"
    } > "${prompt_file}"
  done
  for review in "${REVIEWS[@]}"; do
    (
      if reason="$(run_claude "${dir}/review-${review}.json" "${dir}/${review}.prompt.md" \
        "${PROMPT_DIR}/review-schema.json" "${REVIEW_TOOLS}" 60)"; then
        echo "Review ${review}: $(jq '.findings | length' "${dir}/review-${review}.json") findings"
      else
        echo "::warning::Review ${review} returned no result (${reason})."
        exit 1
      fi
    ) &
  done
  for review in "${REVIEWS[@]}"; do
    wait -n || failed=1
  done
  return "${failed}"
}

# discard_protected_changes: undoes the fixer's edits to protected paths.
discard_protected_changes() {
  local path
  for path in "${PROTECTED_PATHS[@]}"; do
    if git ls-files --error-unmatch "${path}" > /dev/null 2>&1; then
      git checkout HEAD -- "${path}"
    fi
    git clean -fdq -- "${path}"
  done
}

# fix_round <iteration> <findings-file>: returns 1 when nothing changed.
fix_round() {
  local iteration="$1" findings="$2"
  local prompt_file="${WORK_DIR}/fix-${iteration}.prompt.md"
  local result="${WORK_DIR}/fix-${iteration}.json"
  {
    cat "${WORK_DIR}/fix.task.md"
    echo
    echo "Findings to fix (JSON):"
    echo
    echo '```json'
    jq '[.[] | {review, severity, file, line, problem, fix}]' "${findings}"
    echo '```'
  } > "${prompt_file}"

  local reason
  if ! reason="$(run_claude "${result}" "${prompt_file}" "${PROMPT_DIR}/fix-schema.json" "${FIX_TOOLS}" 80)"; then
    echo "::warning::Fix round ${iteration} returned no report (${reason})."
    echo '{"changes":[],"unresolved":[]}' > "${result}"
  fi
  jq -c --argjson iteration "${iteration}" '{iteration: $iteration} + .' "${result}" >> "${WORK_DIR}/rounds.jsonl"

  discard_protected_changes
  git add -A
  if git diff --cached --quiet; then
    return 1
  fi
  git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "Apply AI review fixes (round ${iteration})"
  echo "Fix round ${iteration}: $(jq '.changes | length' "${result}") changes committed"
}

# write_pr_body <rounds> <stop-reason> <check-passed> <remaining-findings-file>
write_pr_body() {
  local rounds="$1" stop_reason="$2" check_passed="$3" remaining="$4"
  local check_text="passes"
  [ "${check_passed}" = true ] || check_text="**fails**"
  {
    echo "Fixes the ${FIX_MIN_SEVERITY}-or-higher AI review findings on #${PR_NUMBER}. Merging this does not start a new AI review."
    echo
    echo "Rounds: ${rounds} of ${MAX_ITERATIONS} · \`npm run check\` ${check_text}"
    [ -z "${stop_reason}" ] || { echo; echo "${stop_reason}"; }
    echo
    echo "### Changes"
    echo
    jq -rs '[.[].changes[]] | unique | if length == 0 then "None." else
      .[] | "- \(.files | map("`\(.)`") | join(", ")): \(.change) \(.reason)" end' "${WORK_DIR}/rounds.jsonl"
    jq -rs '[.[].unresolved[]] | unique | if length == 0 then empty else
      "", "### Not fixed", "", (.[] | "- \(.finding) \(.reason)") end' "${WORK_DIR}/rounds.jsonl"
    jq -r 'unique_by([.file, .line, .problem]) | if length == 0 then empty else
      "", "### Still open", "",
      (.[] | "- **\(.severity)** `\(.file)\(if .line then ":\(.line)" else "" end)`: \(.problem)") end' "${remaining}"
  } > "${WORK_DIR}/pr-body.md"
}

run_loop() {
  local findings="${WORK_DIR}/findings-0.json" iteration=0 stop_reason
  cp "$1" "${findings}"

  local review
  load() { bash "${PROMPT_DIR}/load-prompt.sh" "$1" "$2" > /dev/null; }
  load fix "${WORK_DIR}/fix.task.md"
  load review-rules "${WORK_DIR}/review-rules.md"
  for review in "${REVIEWS[@]}"; do
    load "${review}" "${WORK_DIR}/${review}.task.md"
  done
  : > "${WORK_DIR}/rounds.jsonl"

  while :; do
    if [ "$(jq 'length' "${findings}")" -eq 0 ]; then
      stop_reason=""
      break
    fi
    if [ "${iteration}" -ge "${MAX_ITERATIONS}" ]; then
      stop_reason="Stopped after ${MAX_ITERATIONS} rounds with findings still open."
      break
    fi
    iteration=$((iteration + 1))

    if ! fix_round "${iteration}" "${findings}"; then
      stop_reason="Round ${iteration} made no changes; the rest needs a person."
      break
    fi

    local round_dir="${WORK_DIR}/review-${iteration}"
    mkdir -p "${round_dir}"
    for review in "${REVIEWS[@]}"; do
      cp "${WORK_DIR}/${review}.task.md" "${round_dir}/${review}.task.md"
    done
    if ! review_round "${round_dir}"; then
      # Keep the last complete list of findings; a partial review would hide some.
      stop_reason="The review after round ${iteration} failed, so round ${iteration} is unverified."
      break
    fi
    collect_findings "${round_dir}" "${WORK_DIR}/findings-${iteration}.json" > /dev/null
    findings="${WORK_DIR}/findings-${iteration}.json"
    echo "After round ${iteration}: $(jq 'length' "${findings}") findings at or above ${FIX_MIN_SEVERITY}"
  done

  local check_passed=false
  if npm run check > "${WORK_DIR}/check.log" 2>&1; then
    check_passed=true
  else
    echo "::warning::npm run check fails on the fixed code."
  fi

  local changed=false
  if [ "${iteration}" -gt 0 ] && [ -n "$(git log --oneline "${HEAD_SHA}..HEAD")" ]; then
    changed=true
  fi
  write_pr_body "${iteration}" "${stop_reason}" "${check_passed}" "${findings}"
  {
    echo "changed=${changed}"
    echo "check_passed=${check_passed}"
  } >> "${GITHUB_OUTPUT}"
}

: "${BASE_REF:?}" "${HEAD_REF:?}" "${HEAD_SHA:?}" "${PR_NUMBER:?}" "${REPO:?}" "${WORK_DIR:?}"
mkdir -p "${WORK_DIR}"

case "${1:-}" in
  collect) collect_findings "$2" "$3" ;;
  run) run_loop "$2" ;;
  *)
    echo "Usage: fix-loop.sh collect <reviews-dir> <output-file> | run <findings-file>" >&2
    exit 2
    ;;
esac
