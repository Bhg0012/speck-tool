<p align="center"><img src="assets/wordmark.png" alt="Speck" width="380"></p>

<p align="center"><b>A tiny, discreet AI helper for Mac and Windows.</b><br>
Frame anything on your screen. Get just the answer, with a confidence score, in tiny text.<br>
Runs 100% locally with <a href="https://ollama.com">Ollama</a>.</p>

---

## How it looks

- **Two barely visible corner marks** (top-left and bottom-right) frame what the AI sees. Drag them to resize. A faint outline shows only while you drag.
- **A tiny dot** near the bottom-right of the screen. Click it (or press the hotkey) to ask.
- **The answer** appears at the bottom of the screen in small dark text on a faint white haze, followed by a confidence score, e.g. `B) 36   10/10`.
- **One hotkey hides everything**, and the same hotkey brings it back.

No dock icon, no taskbar button, no big windows.

## Install (one time)

1. **Install [Ollama](https://ollama.com/download)** (runs the AI on your computer).
2. **Install [Git](https://git-scm.com/downloads)** and **[Node.js LTS](https://nodejs.org)**. The launchers offer to install Node for you if it's missing.
3. Get Speck:
   ```bash
   git clone https://github.com/bhg0012/speck-tool.git
   ```

## Start

| Mac | Windows |
| --- | --- |
| Double-click **`Start Speck (Mac).command`** | Double-click **`Start Speck (Windows).bat`** |

Each launch **pulls the latest version from GitHub**, installs anything new, makes sure Ollama is running, downloads the AI model the first time (a few GB), then starts Speck in the background.

> **Mac, first run:** macOS asks for **Screen Recording** permission (it may be listed as *Electron*). Allow it, then start Speck again.
> If macOS blocks the `.command` file, right-click it and choose **Open**.

## Use

| Action | Mac | Windows |
| --- | --- | --- |
| Ask about what's framed | `⌘⌥A` or click the dot | `Ctrl+Alt+A` or click the dot |
| Ask with max accuracy | `⌘⌥D` | `Ctrl+Alt+D` |
| **Hide / show everything** | `⌘⌥H` | `Ctrl+Alt+H` |
| Copy last answer | `⌘⌥C` | `Ctrl+Alt+C` |
| Settings | `⌘⌥,` or right-click the dot | `Ctrl+Alt+,` or right-click the dot |

- **Hover** the answer to see the full text and a short note. **Click** it to copy, **right-click** it to dismiss.
- **Ghost mode:** while everything is hidden, the Ask hotkey still works. Only the tiny answer appears.
- Drag the dot anywhere you like. Speck remembers the positions.
- All hotkeys can be changed in Settings.

## Accuracy

Speck never trusts a single answer. In the default **Careful** mode:

1. A **vision model reads** the framed area and transcribes it exactly (text, math, options, diagrams).
2. A **solver** works out the answer step by step (hidden), returning only the final answer.
3. An **independent checker** re-solves from scratch and compares.
4. If they disagree, a **tie-breaker** solve decides by majority.
5. Numeric answers are **re-computed** with a built-in calculator.

The **confidence score (x/10)** reflects how many independent attempts agreed, the arithmetic re-check, the models' own certainty, and how legible the capture was. Anything below about 7 means "double-check this yourself".

| Mode | What it does |
| --- | --- |
| Fast | One pass. Quickest. Confidence capped at 8 because it isn't verified. |
| **Careful** (default) | Read, solve, verify, and tie-break when needed. |
| Max (`Ctrl/⌘+Alt+D`) | Two independent solves plus verification at maximum reasoning effort. |

## Models

Choose models in **Settings**. Recommended ones download with one click.

| Model | Role | Notes |
| --- | --- | --- |
| `qwen3-vl:8b` *(default)* | Reader + solver | Excellent at reading screens, math and charts. ~6 GB. |
| `qwen3-vl:4b` | Reader | For 8 GB machines. |
| `gemma3:12b`, `qwen2.5vl:7b` | Reader | Alternatives. |
| `gpt-oss:20b` | Solver | Strongest reasoning and math. Needs 16 GB+ RAM. Text-only, so it's paired with a vision reader. |

The solver defaults to **Auto**: if `gpt-oss` is installed it does the reasoning, otherwise the reader model does everything.

## Privacy

Screenshots go only to Ollama on your own computer (`127.0.0.1`). Nothing is uploaded anywhere. Settings live in `~/Library/Application Support/Speck` (Mac) or `%APPDATA%\Speck` (Windows).

## Troubleshooting

- **"Ollama isn't running"**: open the Ollama app, or run `ollama serve`.
- **"No vision model"**: open Settings, then *Download models*, then `qwen3-vl:8b`.
- **A hotkey doesn't work**: another app owns it. Pick a new one in Settings.
- **Blank or wallpaper-only answers on Mac**: grant Screen Recording (System Settings, then Privacy & Security, then Screen Recording), then restart Speck.
- **Markers lost off-screen**: tray/menu bar icon (or right-click the dot), then *Reset capture area*.

## For developers

```bash
npm install
npm start        # run the app
npm test         # unit + pipeline tests (no Ollama needed)
```

Product vision and decisions live in [`docs/VISION.md`](docs/VISION.md).
