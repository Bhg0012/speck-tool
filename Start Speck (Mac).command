#!/bin/bash
# Double-click to start Speck on macOS.
# It updates Speck from GitHub, installs what's needed, then starts it in the background.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
clear

pause_and_exit() {
  echo
  read -n 1 -s -r -p "  Press any key to close..."
  exit 1
}

# 1. Update from GitHub
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "  Checking for updates..."
  if ! git pull --ff-only --quiet 2>/dev/null; then
    echo "  (Couldn't update right now. Starting the current version.)"
  fi
fi

# 2. Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "  Speck needs Node.js (free)."
  if command -v brew >/dev/null 2>&1; then
    echo "  Installing it with Homebrew..."
    brew install node || pause_and_exit
  else
    echo "  Download the LTS installer from https://nodejs.org, install it, then double-click this file again."
    open "https://nodejs.org/en/download"
    pause_and_exit
  fi
fi

# 3. Everything else (dependencies, Ollama, model, launch)
node scripts/start.js || pause_and_exit
exit 0
