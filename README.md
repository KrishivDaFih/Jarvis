# Jarvis

A desktop AI assistant with a Mark 85 arc reactor HUD. Electron shell, three
providers (Anthropic / OpenAI / Groq), local settings, global hotkey.

---

## 1. Run it from source

You need **Node.js 18 or newer** (Node 20 LTS recommended).

```bat
cd jarvis
npm install
npm start
```

The first launch opens the settings sheet automatically because no API key is
stored yet. Paste a key, pick a provider, save.

---

## 2. Build the setup file

```bat
npm run dist
```

electron-builder writes the installer to:

```
dist\Jarvis-Setup-2.0.0.exe
```

That is a proper NSIS installer:

* asks where to install (`allowToChangeInstallationDirectory`)
* creates a Start Menu entry and a Desktop shortcut
* installs per-user, so **no admin prompt**
* registers a matching uninstaller in Apps & Features
* uses the arc reactor icon for the app, the installer header, and the uninstaller

If you would rather have a single portable .exe with no installation:

```bat
npm run dist:portable
```

**Build it on Windows.** Cross-building a Windows installer from Linux or macOS
needs Wine and frequently breaks — it is not worth the trouble.

The first `npm run dist` downloads the Electron binaries and the NSIS toolchain
(roughly 250 MB). That happens once and is cached in `%LOCALAPPDATA%\electron-builder\Cache`.

---

## 3. Where things live

| What | Path |
|---|---|
| Settings + API keys | `%APPDATA%\Jarvis\settings.json` |
| Installed app | `%LOCALAPPDATA%\Programs\Jarvis` |
| Build output | `jarvis\dist` |

Uninstalling leaves `settings.json` in place on purpose, so reinstalling keeps
your keys. Delete that folder by hand if you want a clean slate.

---

## 4. Controls

| Action | How |
|---|---|
| Show / hide from anywhere | `Ctrl + Shift + J` (editable in settings) |
| Send | `Enter`, or the Send button |
| Settings | cog icon, top right |
| Close settings without saving | `Esc` |
| Move the window | drag the top bar |

---

## 5. The reactor states

The reactor is the status indicator, not decoration:

| State | Look |
|---|---|
| Standby | cool blue-white, slow plate rotation |
| Listening | shifts gold, housing speeds up |
| Processing | plates spin ~10× faster, core pulses hard |
| Speaking | whole assembly pulses |
| Error | shifts red |

---

## 6. Known limits — read this

**Dictation.** The mic button uses the browser `SpeechRecognition` API. In
stock Electron that API is usually missing, because Chromium's speech service
needs Google API keys that Electron does not ship. If you press the mic and get
"Speech recognition is not available in this build", that is why — it is not a
bug in the app. To get real voice input you need to wire in an actual STT
service (Whisper running locally, Deepgram, AssemblyAI, or similar). Say the
word and I'll add it.

**Fonts.** Chakra Petch and JetBrains Mono load from Google Fonts, so offline
the app falls back to system sans and mono. It still looks fine, just less
distinctive. If you want it fully offline, download both families as `.woff2`,
drop them in `renderer/fonts/`, and swap the `<link>` for local `@font-face`
rules.

**Model names.** Defaults are `claude-sonnet-4-5`, `gpt-4o-mini`, and
`llama-3.3-70b-versatile`. Model names get retired regularly — if a request
fails with "model not found", update the Model field in settings rather than
assuming the app is broken.

**No computer control.** This build is chat only. The mouse/keyboard/screenshot
tooling from your earlier Kairos build is not in here.

---

## 7. Coming from Kairos

This is a fresh project, not a patch on your old Kairos source. If you want the
UI dropped into the existing Kairos codebase instead, the pieces to copy are
`renderer/index.html`, `renderer/style.css`, and the reactor markup — but the
IPC channel names here (`chat:send`, `settings:get`, `settings:save`,
`window:minimize`, `window:close`) will almost certainly not match Kairos's, so
`app.js` needs rewiring to whatever Kairos's preload exposes.
