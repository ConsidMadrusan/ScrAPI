#!/usr/bin/env bash
# Usage: upsert-comment.sh <marker> <body-file>
#
# Creates or updates the one PR comment from github-actions[bot] whose body
# starts with <marker>. The body file must start with the marker.
# Needs GH_TOKEN, REPO, and PR_NUMBER.
set -euo pipefail

marker="$1"
body_file="$2"

existing_id="$(gh api --paginate "repos/${REPO:?}/issues/${PR_NUMBER:?}/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"${marker}\"))) | .id" \
  | head -n 1)"

if [ -n "${existing_id}" ]; then
  gh api --method PATCH "repos/${REPO}/issues/comments/${existing_id}" -F "body=@${body_file}" > /dev/null
else
  gh api --method POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -F "body=@${body_file}" > /dev/null
fi
