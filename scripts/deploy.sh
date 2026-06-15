#!/usr/bin/env bash
set -euo pipefail

remote_host="${DEPLOY_HOST:-godzilla}"
remote_path="${DEPLOY_PATH:-/var/www/innovatiebudget-3dtiles}"
remote="${remote_host}:${remote_path}/"

for command in bun ssh rsync; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

bun run build:minimal-ui

ssh "$remote_host" "mkdir -p '$remote_path'"
rsync -az --delete --exclude "*/3dt-export-nl*/" dist/ "$remote"

echo "Deployed dist/ to $remote"
