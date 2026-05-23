#!/usr/bin/env bash
# Wrapper for launchd: sources .env before starting the server.
# systemd uses EnvironmentFile= directly and does not need this script.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck source=../.env.example
source .env
set +a
exec node dist/index.js
