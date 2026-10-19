# Speck - Product Vision

> **This is the source of truth for what Speck is supposed to be.**
> Read it before making any product or design decision. When Bruce (the owner)
> shares a new idea, preference, or insight, add it to the **Vision Log** at the
> bottom (dated) and update the relevant section above it, in the same commit as
> the change. Chat history goes away; this file does not.

---

## 1. What Speck is

Speck is a tiny, discreet desktop AI helper for **macOS and Windows**. You frame
part of your screen (a question, a math problem, a task, anything), press a
button or hotkey, and a **locally hosted LLM (via Ollama)** reads that region and
shows **just the answer**, along with a **confidence score out of 10**, in tiny text
at the bottom of the screen.

The name: a *speck* is something you can barely see. That is the whole design
philosophy.

## 2. Non-negotiables

1. **Discreet above all.** Barely noticeable to anyone else looking at the
   screen. No big windows, no big boxes, no taskbar/dock presence, no loud colors.
2. **Accuracy is vital.** "We cannot have any margin of error." Every answer is
   double-checked before it is shown, and a confidence score (x/10) is always
   available so the user knows how much to trust it.
3. **Brief answers.** Only the answer, not a long LLM essay or visible chain of
   thought. A number, a word, an option ("B) 42"), or one short sentence.
4. **Local and private.** The LLM runs on the user's machine through Ollama.
   Nothing is sent to the cloud.
5. **Easy to start, always up to date.** One double-click launcher for Mac and one for
   PC, plus the Speck.app Dock icon. **Every launch must update to the latest `main` on
   GitHub. This is crucial.** All three run the same `scripts/start.js` + `scripts/update.js`,
   and an already-running old version is restarted into the new one.
   On Windows, a "Speck" shortcut with the Speck icon (folder + Start Menu) is the equivalent of
   the Mac's Speck.app.
6. **Fast.** Answers should come back in seconds, not minutes (see docs/PERFORMANCE.md).
   On Mac, `Speck.app` can sit in the Dock as a one-click launcher (no Terminal
   window). The running Speck itself still has no Dock icon.
7. **Quick, powerful, satisfying** for daily work and normal tasks.

## 3. The experience (as envisioned)

### Capture area
- **Not a big box.** Only two small, translucent markers: a **top-left** corner and a
  **bottom-right** corner. Drag them to frame what the AI should see.
- Markers are barely visible (low opacity) and brighten slightly on hover.
- Current design: thin "L" corner brackets (they read as "the corners of a
  box" without drawing the box). A faint dashed outline appears **only while
  dragging** so you can see what you're framing, then disappears.

### Asking
- A tiny button near the bottom of the screen (a small translucent dot), **or** a
  global hotkey, sends whatever is between the two corners to the LLM.
- While it works, **only the dot pulses**. No "reading..." or progress text, ever.
  Text at the bottom appears only when the answer is ready.
- Right-click the dot for the menu: version number + when it was updated (to confirm
  updates landed), history, settings, restart, quit. There's also a quit hotkey.
- With two (or more) monitors the menu has **"Switch to other monitor"**: the corners, the dot
  and the answer all jump to the other screen in the same layout (the capture area keeps its size
  and relative spot; the dot keeps its distance from its corner). No dragging each part across.

### History
- The last 30 questions and answers (text only, never screenshots, ~30 KB in total, on this
  computer only). Anything beyond 30 is deleted. Opened from the dot's menu or a hotkey.
- A small dark scrollable window, newest first. Each entry has a Copy button (full question +
  answer + confidence). There's a Clear button, and history can be turned off in Settings.
- The markers are hidden for the instant the screenshot is taken, so they never
  end up in the image.

### The answer
- Appears at the **bottom of the screen in tiny text**.
- **Black text on a slight translucent white haze**, so it stays readable even over
  a black background. (Other themes are available in settings.)
- Format: `answer   9/10`.
- Hover to see the full answer plus a few-word note. Click to copy.

### Hide everything
- A global key combination makes **everything disappear** (markers, button, answer).
  Press it again and it all comes back.
- Hotkeys keep working while hidden ("ghost mode"): you can still ask and only
  the tiny answer shows.

### Models
- The user chooses the model in Settings. Bruce mentioned GPT-OSS; it is text-only (can't see
  images), so it's only offered as an optional solver behind a vision model.
- Default: `qwen3-vl:8b-instruct`, one vision model that reads and answers. The "thinking"
  `qwen3-vl:8b` was the v1.0 default and made answers take minutes.

## 4. Accuracy pipeline (how "double-check" works)

| Mode | Steps |
| --- | --- |
| **Fast** | One attempt. Confidence capped at 8 (unverified). |
| **Careful** *(default)* | Two independent attempts (the second uses a different method); tie-break on disagreement. |
| **Max** (deep hotkey) | Three independent attempts; tie-break if there's no majority. |

Each attempt copies the question exactly and shows short working before the answer. Confidence
(1-10) combines the model's own confidence, **agreement between independent attempts**, and an
**arithmetic re-computation** of numeric answers. Disagreement always pulls the score down.

## 5. Design language

- Logo: a dark rounded square with two thin corner brackets (the capture markers)
  and one small mint "speck" dot. Ultra simple, modern, techy. Files are in `assets/`.
- Accent color: mint `#7CF7D4`. Background: near-black `#0A0A0C`.
- UI text: system font, small, low contrast, no chrome.

## 6. Ideas / future (not built yet)

- Packaged installers (.dmg / .exe) once the feature set settles.
- Answer history (cycle previous answers with a hotkey).
- Optional "explain" hotkey that shows a 1-line rationale.

---

## Vision Log

Newest at the bottom. Add an entry every time Bruce shares a new vision, preference, or insight.

- **2026-10-16** - Original vision. Name is **Speck** ("like a speck you can barely
  see"). Wants a really simple, modern, cool, tech-like logo. Mac + PC. Local LLM on
  Ollama, with a choice of model (e.g. GPT-OSS or whatever is best). Two tiny translucent
  corner markers (top-left and bottom-right) instead of a box. Button near the bottom
  of the screen or the toolbar to send. Tiny answer at the bottom: black text, slight
  white translucent hue behind it. Short answer only, with confidence out of 10, and it
  must double-check because accuracy is vital. A hotkey hides and shows everything.
  One-click start buttons for Mac and PC that pull the latest from GitHub. All visions
  must be saved in the repo so they're never lost. "I can't emphasize enough how
  discreet I want it to be."
- **2026-10-16** - Wants Speck as an app icon in the MacBook Dock. Built `Speck.app`
  (a launcher bundle in the repo root with the Speck icon): click it to update and start
  Speck silently. First-time setup still opens Terminal so progress is visible. The running
  overlay keeps hiding its own Dock icon to stay discreet.
- **2026-10-16** - Clicking the dot sent Bruce to System Settings (Screen Recording; only
  Terminal was listed). Fix: on Mac, Speck is launched as its own app ("Electron") so it gets
  its own permission, restarts itself once permission is granted, and has a "Restart Speck"
  menu item.
- **2026-10-16** - Standing instruction: push, pull request and merge every change into `main`
  automatically, without asking (recorded in CLAUDE.md).
- **2026-10-16** - "Reading" took minutes with no answer. Wants answers **pretty quickly**.
  Root cause: thinking model + model reloads + too many calls (docs/PERFORMANCE.md). Switched to
  `qwen3-vl:8b-instruct`, 2 independent attempts, no reloads.
- **2026-10-16** - No "reading" text at the bottom: not discreet. Only the dot pulses while
  working; text appears only with the answer.
- **2026-10-16** - Wants an easy way to quit: quit hotkey + "Quit Speck" in the dot's menu.
- **2026-10-16** - Updates are **absolutely crucial**: Mac/Windows launchers and Speck.app must all
  update to the latest GitHub version, and Speck.app must actually work (no "move it to the
  Dock" message). Everything must be tested before pushing.
- **2026-10-16** - Right-clicking the dot shows the version number and when it was updated, so
  Bruce can confirm an update landed.
- **2026-10-18** - The Mac launcher wasn't pulling updates. Cause: the GitHub repo is private and
  Bruce's copy was a ZIP download, so the old launcher skipped the pull silently. Launchers now say
  plainly when GitHub needs a login, and the menu shows "Updates blocked". Fix: public repo, or
  `gh auth login`.
- **2026-10-18** - Wants a history of the last 30 questions + answers (only if it's light on
  storage: it is, text only, ~30 KB), opened from the Speck dot, scrollable, with a button to
  copy the whole question and answer. Older entries deleted.
- **2026-10-18** - On Windows there was no app icon in the folder like on Mac. Added a "Speck"
  shortcut with the Speck icon (folder + Start Menu, pinnable) that starts Speck silently.
- **2026-10-18** - On Windows the dot and corner brackets showed a faint box around them, and the
  dot showed a hand cursor that made it hard to click. Must look and feel like the Mac: no box,
  normal arrow cursor, easy to click.
- **2026-10-19** - Windows still showed a faint box behind the dot and brackets. Fix: overlay windows
  are clipped to exactly what they draw (setShape) and the Windows backdrop is off.
- **2026-10-19** - Windows "loads and loads" while the Mac answers in seconds. **Windows and Mac must
  look, act and feel identical.** Same app and code on both; speed depends on the hardware
  running the model. A PC without a supported graphics card runs it on the CPU (measured 45 s to
  3 min). Added: Speed test (Settings) with one-click fixes, Copy diagnostics, and sharing the Mac's
  AI with the PC over the home network (with automatic fallback to the PC's own Ollama).
- **2026-10-19** - After v1.4.0 nothing was visible when starting Speck. Removed the Windows "no
  backdrop" window option (the likely cause). Trimming can never block start-up now: it's guarded,
  with a backup "show" and a Settings toggle. Errors go to speck.log, and the launcher reports it if
  Speck dies right after starting. Nothing may ever fail silently.
- **2026-10-19** - Bruce's Windows PC: Surface Laptop Studio, i7-11370H, 16 GB RAM, **NVIDIA GeForce
  RTX 3050 Ti Laptop GPU (4 GB)** + Intel Iris Xe. The 8B model (~7 GB) didn't fit the 4 GB card and
  ran mostly on the CPU. The launcher now picks the model for the graphics card automatically
  (4 GB NVIDIA -> qwen3-vl:4b-instruct; Apple silicon -> 8b), and the context is trimmed to fit 4 GB.
- **2026-10-19** - On Windows only the top-left bracket showed: no bottom-right bracket and no dot,
  so Speck couldn't be used. Cause: Windows can make a brand-new tiny window bigger than asked, and
  the bottom-right bracket and dot were drawn from the window's far edge/centre, outside the trimmed
  area. Fix: everything is drawn from the window's top-left, the windows are always sized exactly,
  and the trim is redone when a window moves to a screen with different scaling. **Every part
  (both brackets, the dot, the answer) must be visible and usable on Windows, exactly like the Mac.**
- **2026-10-19** - With two monitors it was annoying to drag each part to the other screen. Added
  "Switch to other monitor" to the dot's menu: everything moves over in the same layout.
- **2026-10-19** - On the Mac a faint little box showed behind the brackets: not discreet. Cause: a 1%
  tint filled each bracket/dot window so it could be clicked. Removed: nothing is drawn behind the
  marks now (the Mac window is told to take clicks anyway; only a 1/255 grab area hugs each mark).
  **No hue, box or tint around any mark, ever, on any OS.**
