'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  send:         history => ipcRenderer.invoke('chat:send', history),
  getSettings:  ()      => ipcRenderer.invoke('settings:get'),
  saveSettings: next    => ipcRenderer.invoke('settings:save', next),

  minimize:         () => ipcRenderer.send('window:minimize'),
  close:            () => ipcRenderer.send('window:close'),
  toggleMax:        () => ipcRenderer.send('window:toggle-maximize'),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  exitFullscreen:   () => ipcRenderer.send('window:exit-fullscreen'),
  isFullscreen:     () => ipcRenderer.invoke('window:is-fullscreen'),

  // fn(true|false) — fired when the window enters or leaves fullscreen
  onFullscreen: fn => ipcRenderer.on('window:fullscreen', (_e, v) => fn(v)),
  onMaximized:  fn => ipcRenderer.on('window:maximized',  (_e, v) => fn(v))
});
