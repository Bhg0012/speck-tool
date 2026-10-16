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
5. **Easy to start.** One double-click launcher for Mac and one for PC. Each
   launch pulls the latest version from GitHub so it is always up to date.
   On Mac, `Speck.app` can sit in the Dock as a one-click launcher (no Terminal
   window). The running Speck itself still has no Dock icon.
6. **Quick, powerful, satisfying** for daily work and normal tasks.

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
- The user chooses which model(s) to use. Bruce mentioned GPT-OSS. Note that
  GPT-OSS is text-only and **cannot see images**, so Speck uses a two-stage design:
  - **Reader** (vision model, default `qwen3-vl:8b`) transcribes the region exactly.
  - **Solver** (default "auto": `gpt-oss:20b` if installed, otherwise the reader)
    reasons out the answer.
- Models can be chosen and downloaded from the Settings window.

## 4. Accuracy pipeline (how "double-check" works)

| Mode | Steps |
| --- | --- |
| **Fast** | Single pass. Confidence is capped at 8 because the answer isn't verified. |
| **Careful** *(default)* | Read, then solve, then an independent verifier solves it again and compares. If they disagree, a tie-breaker solve decides by majority. |
| **Max** (deep hotkey) | Read, then two independent solves (different method/seed), then verify. Tie-break at high reasoning effort on any disagreement. |

Confidence (1-10) combines the models' own confidence, **agreement between
independent attempts**, an **arithmetic re-computation** of numeric answers (a
safe expression evaluator checks the model's math), and the **legibility** of the
captured region. Disagreement or unreadable input always pulls the score down.

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
