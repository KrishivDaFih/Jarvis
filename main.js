'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

/* ────────────────────────────────────────────────
   Settings — stored as JSON in the user data dir
   Windows: %APPDATA%\Jarvis\settings.json
   ──────────────────────────────────────────────── */
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  provider: 'anthropic',           // anthropic | openai | groq
  apiKeys: { anthropic: '', openai: '', groq: '' },
  models: {
    anthropic: 'claude-sonnet-4-5',
    openai: 'gpt-4o-mini',
    groq: 'llama-3.3-70b-versatile'
  },
  shortcut: 'Control+Shift+J',
  systemPrompt:
    "You are Jarvis, a calm, precise personal assistant. Speak briefly and " +
    "directly, the way a competent aide would. Never pad answers with filler. " +
    "If a request is ambiguous, ask one short clarifying question. " +
    "Address the user as 'sir' only occasionally, never in every message."
};

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH(), 'utf8');
    const saved = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...saved,
      apiKeys: { ...DEFAULTS.apiKeys, ...(saved.apiKeys || {}) },
      models: { ...DEFAULTS.models, ...(saved.models || {}) }
    };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

function writeSettings(next) {
  const merged = { ...readSettings(), ...next };
  fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

/* ────────────────────────────────────────────────
   Window
   ──────────────────────────────────────────────── */
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    backgroundColor: '#03080e',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // open external links in the real browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerShortcut(accelerator) {
  globalShortcut.unregisterAll();
  if (!accelerator) return false;
  try {
    return globalShortcut.register(accelerator, () => {
      if (!win) return;
      if (win.isVisible() && win.isFocused()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    });
  } catch (err) {
    return false;
  }
}

app.whenReady().then(() => {
  createWindow();
  registerShortcut(readSettings().shortcut);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

/* ────────────────────────────────────────────────
   IPC — window controls
   ──────────────────────────────────────────────── */
ipcMain.on('window:minimize', () => win && win.minimize());
ipcMain.on('window:close', () => win && win.close());

/* ────────────────────────────────────────────────
   IPC — settings
   ──────────────────────────────────────────────── */
ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:save', (_evt, next) => {
  const merged = writeSettings(next);
  registerShortcut(merged.shortcut);
  return merged;
});

/* ────────────────────────────────────────────────
   IPC — chat
   history: [{ role: 'user' | 'assistant', content: '...' }]
   Requests run in the main process, so there is no CORS
   and the API key never reaches the page.
   ──────────────────────────────────────────────── */
ipcMain.handle('chat:send', async (_evt, history) => {
  const s = readSettings();
  const key = (s.apiKeys[s.provider] || '').trim();

  if (!key) {
    return { ok: false, error: 'No API key set for ' + s.provider + '. Open settings and add one.' };
  }

  try {
    if (s.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: s.models.anthropic,
          max_tokens: 1024,
          system: s.systemPrompt,
          messages: history
        })
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: describe(data, res.status) };
      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      return { ok: true, text: text || '(empty response)' };
    }

    // OpenAI and Groq share the same chat-completions shape
    const endpoint = s.provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model: s.models[s.provider],
        max_tokens: 1024,
        messages: [{ role: 'system', content: s.systemPrompt }, ...history]
      })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: describe(data, res.status) };
    const text = (((data.choices || [])[0] || {}).message || {}).content || '';
    return { ok: true, text: text.trim() || '(empty response)' };

  } catch (err) {
    return { ok: false, error: 'Request failed: ' + err.message };
  }
});

function describe(data, status) {
  if (data && data.error) {
    return (data.error.message || JSON.stringify(data.error)) + ' (HTTP ' + status + ')';
  }
  return 'HTTP ' + status;
}
