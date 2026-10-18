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
| Double-click **`Start Speck (Mac).command`** (or click **Speck** in your Dock) | Double-click **`Start Speck (Windows).bat`** |

**Windows Speck icon:** the first time you run `Start Speck (Windows).bat`, it adds a **Speck** shortcut with the Speck icon, both in the `speck-tool` folder and in the Start Menu (search "Speck"). Use that from then on. It updates and starts Speck with no console window (the console only opens for first-time setup or downloads). Right-click it and choose **Pin to taskbar** if you like.

**Mac Dock icon:** in the `speck-tool` folder, drag **`Speck.app`** onto your Dock. Clicking it updates and starts Speck with no Terminal window (Terminal only opens for first-time setup or when something needs downloading). Keep `Speck.app` in the `speck-tool` folder; the Dock just points to it. Clicking it while Speck is hidden brings it back.

Every launch **updates Speck to the latest version on GitHub** (all three launchers run the same `scripts/start.js`), installs anything new, makes sure Ollama is running, downloads the AI model the first time (about 6 GB), then starts Speck in the background. If an older Speck is still running, it is restarted into the new version.

**Check your version:** right-click the dot. The top of the menu shows the version, when that version was published, and when Speck last checked for updates.

> **Mac, first run:** macOS asks for **Screen Recording** permission (it may be listed as *Electron*). Allow it, then start Speck again.
> If macOS blocks the `.command` file, right-click it and choose **Open**.

## Updates

Every launch runs `git fetch` against this repository. **This repository is private**, so the Mac
needs a saved GitHub login, or updates are blocked. The launcher then says *"GitHub needs a login"*,
and the dot's menu says *"Updates blocked"*. Fix it once, either way:

- **Make the repository public** (simplest): GitHub, then **Settings**, then **General**, then
  *Danger Zone*, then **Change visibility**, then **Public**. No login is needed after that.
- **Keep it private:** install GitHub CLI (`brew install gh`), then run `gh auth login` (choose
  GitHub.com, HTTPS, *Login with a web browser*) and `gh auth setup-git`.

Copies downloaded as a ZIP are turned into proper clones automatically on the next launch,
once GitHub access works.

## Use

| Action | Mac | Windows |
| --- | --- | --- |
| Ask about what's framed | `⌘⌥A` or click the dot | `Ctrl+Alt+A` or click the dot |
| Ask with max accuracy | `⌘⌥D` | `Ctrl+Alt+D` |
| **Hide / show everything** | `⌘⌥H` | `Ctrl+Alt+H` |
| Copy last answer | `⌘⌥C` | `Ctrl+Alt+C` |
| Settings | `⌘⌥,` or right-click the dot | `Ctrl+Alt+,` or right-click the dot |
| History (last 30) | `⌘⌥Y` or right-click the dot, then *History…* | `Ctrl+Alt+Y` or right-click the dot, then *History…* |
| **Quit Speck** | `⌘⌥Q` or right-click the dot, then *Quit Speck* | `Ctrl+Alt+Q` or right-click the dot, then *Quit Speck* |

- While Speck works, **only the dot pulses**. Nothing appears at the bottom until the answer is ready.
- **Hover** the answer to see the full text and a short note. **Click** it to copy, **right-click** it to dismiss.
- **Ghost mode:** while everything is hidden, the Ask hotkey still works. Only the tiny answer appears.
- **History:** the last 30 questions and answers, newest first, each with a **Copy** button that copies the whole question and answer. Older entries are deleted automatically. It's text only (about 1 KB each, roughly 30 KB in total) and stays on this computer. Use **Clear** to wipe it, or turn history off in Settings.
- Drag the dot anywhere you like. Speck remembers the positions.
- All hotkeys can be changed in Settings.

## Accuracy

Speck never trusts a single answer. In the default **Careful** mode:

1. The vision model **solves the framed question twice, independently** (the second time with a different method), copying the question exactly and showing short working.
2. If the two answers disagree, a **tie-breaker** attempt decides by majority.
3. Numeric answers are **re-computed** with a built-in calculator.

The **confidence score (x/10)** reflects how many independent attempts agreed, the arithmetic re-check, the models' own certainty, and how legible the capture was. Anything below about 7 means "double-check this yourself".

| Mode | What it does |
| --- | --- |
| Fast | One attempt (~8 s on an M-series Mac). Confidence capped at 8 because it isn't verified. |
| **Careful** (default) | Two independent attempts plus a tie-break when needed (~15-20 s). |
| Max (`Ctrl/⌘+Alt+D`) | Three independent attempts plus a tie-break if there's no majority. |

See [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) for measurements.

## Models

Choose models in **Settings**. Recommended ones download with one click.

| Model | Notes |
| --- | --- |
| `qwen3-vl:8b-instruct` *(default)* | Fast and accurate at reading screens, math and charts. ~6 GB. |
| `qwen3-vl:4b-instruct` | About twice as fast, a little less accurate. For 8 GB Macs. |
| `qwen3-vl:8b` | "Thinking" version: more deliberate but **much** slower. |
| `gemma3:12b` | Alternative vision model. |
| `gpt-oss:20b` | Optional text-only solver (a vision model reads the screen for it). Slow; needs 16 GB+ RAM. |

## Privacy

Screenshots go only to Ollama on your own computer (`127.0.0.1`). Nothing is uploaded anywhere. Settings live in `~/Library/Application Support/Speck` (Mac) or `%APPDATA%\Speck` (Windows).

## Troubleshooting

- **"Ollama isn't running"**: open the Ollama app, or run `ollama serve`. (If Speck shows nothing but the dot keeps pulsing, it *is* connected and the model is working.)
- **"The model is too slow on this computer"**: switch to Fast mode or `qwen3-vl:4b-instruct` in Settings.
- **Not sure it updated?** Right-click the dot and check the version and date at the top.
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
