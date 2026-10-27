#!/usr/bin/env bash
# Usage: load-prompt.sh <name> <output-file>
#
# Writes .github/ai-review/<name>.md to <output-file>, read from the base branch
# (BASE_REF) so a pull request cannot change its own instructions. While the
# prompt is not on the base branch yet, the checked-out copy is used instead.
# Prints the source ("base" or "pr"). Exits 3 when the prompt does not exist.
set -euo pipefail

name="$1"
output="$2"
prompt_path=".github/ai-review/${name}.md"

if git cat-file -e "origin/${BASE_REF:?}:${prompt_path}" 2>/dev/null; then
  git show "origin/${BASE_REF}:${prompt_path}" > "${output}"
  echo "base"
elif [ -f "${prompt_path}" ]; then
  echo "::warning::${prompt_path} is not on ${BASE_REF} yet; using the pull request's copy." >&2
  cp "${prompt_path}" "${output}"
  echo "pr"
else
  echo "::notice::${prompt_path} does not exist." >&2
  exit 3
fi
