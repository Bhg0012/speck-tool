#!/bin/bash
# Double-click to start Speck on macOS.
# Updates Speck to the latest version on GitHub, installs what's needed, then starts it.
# All the logic is in scripts/start.js (shared with Windows and Speck.app).
# Everything lives in main() and ends in `exec`, so an update can safely replace this file.

main() {
  cd "$(dirname "$0")" || exit 1
  # Remember where Speck lives so Speck.app (Dock icon) can always find it.
  mkdir -p "$HOME/Library/Application Support/Speck" && pwd >"$HOME/Library/Application Support/Speck/repo-path"
  xattr -dr com.apple.quarantine . >/dev/null 2>&1
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  clear

  if ! command -v node >/dev/null 2>&1; then
    echo "  Speck needs Node.js (free)."
    if command -v brew >/dev/null 2>&1; then
      echo "  Installing it with Homebrew..."
      brew install node || { read -n 1 -s -r -p "  Press any key to close..."; exit 1; }
    else
      echo "  Download the LTS installer from https://nodejs.org, install it, then double-click this file again."
      open "https://nodejs.org/en/download"
      read -n 1 -s -r -p "  Press any key to close..."
      exit 1
    fi
  fi

  exec node scripts/start.js "$@"
}

main "$@"; exit $?
