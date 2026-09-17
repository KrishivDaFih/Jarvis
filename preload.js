'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  send:        history => ipcRenderer.invoke('chat:send', history),
  getSettings: ()      => ipcRenderer.invoke('settings:get'),
  saveSettings: next   => ipcRenderer.invoke('settings:save', next),
  minimize:    ()      => ipcRenderer.send('window:minimize'),
  close:       ()      => ipcRenderer.send('window:close')
});
