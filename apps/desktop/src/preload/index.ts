import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('murl', {
  engineHealth: () => ipcRenderer.invoke('engine:health'),
});
