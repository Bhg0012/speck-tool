# Notes for Claude (and any contributor)

**Before making any decision about Speck, read `docs/VISION.md`.** It holds the
owner's (Bruce's) vision, non-negotiables and a dated Vision Log.

When Bruce shares a new idea, preference or insight in a chat:
1. Add a dated entry to the **Vision Log** at the bottom of `docs/VISION.md`.
2. Update the relevant section of `docs/VISION.md` so it stays accurate.
3. Commit it together with the related change.

## Project map
- `src/main/` - Electron main process (windows, hotkeys, capture, Ollama, solver pipeline).
  - `solver.js` - read, then solve, then verify, then confidence. `answer.js` and `mathcheck.js` are pure and unit-tested.
- `src/renderer/` - overlay UI (corner markers, dot button, answer bar) and settings window.
- `src/shared/defaults.js` - default settings plus the settings file location (used by the app and the launcher).
- `scripts/start.js` - cross-platform launcher logic (deps, Ollama, model pull, start).
- `Start Speck (Mac).command`, `Start Speck (Windows).bat` - double-click launchers (they `git pull` first).
- `Speck.app/` - macOS Dock launcher (bash script bundle). Runs `scripts/start.js --quiet`; exit code 3 means
  "needs visible setup", so it opens the `.command` in Terminal.

## Git workflow (Bruce's standing instruction, 2026-10-16)
Push, open a pull request into `main`, and merge it for **every** change, without asking first.
Use a merge commit (not squash) so the working branch stays in sync with `main`.
`main` is what the launchers update from.

## Rules of thumb
- Discreet first: nothing big, bright or persistent on screen; no taskbar/dock presence.
- Accuracy first: never drop the verification step from the default mode.
- Zero runtime npm dependencies (Electron only). Keep the install fast.
- Run `npm test` before pushing.
