#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git pull
npm ci --omit=dev
npm run build

echo ""
echo "Build complete. Restart the service to apply the update:"
echo "  Linux:  sudo systemctl restart llm-relay"
echo "  macOS:  sudo launchctl kickstart -k system/com.llm-relay"
