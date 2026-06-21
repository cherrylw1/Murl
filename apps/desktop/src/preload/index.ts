import { contextBridge, ipcRenderer } from 'electron';
import { ProviderId } from '@murl/engine';

contextBridge.exposeInMainWorld('murl', {
  engineHealth: () => ipcRenderer.invoke('engine:health'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setKey: (id: ProviderId, key: string) => ipcRenderer.invoke('settings:setKey', id, key),
    clearKey: (id: ProviderId) => ipcRenderer.invoke('settings:clearKey', id),
    setActive: (id: ProviderId, model: string) => ipcRenderer.invoke('settings:setActive', id, model),
    setOllamaBaseUrl: (url: string) => ipcRenderer.invoke('settings:setOllamaBaseUrl', url),
    test: (id: ProviderId) => ipcRenderer.invoke('settings:test', id),
  },
  runs: {
    start: (input: { goal: string; url: string }) => ipcRenderer.invoke('run:start', input),
    cancel: (runId: string) => ipcRenderer.invoke('run:cancel', runId),
    onEvent: (cb: (e: any) => void) => {
      const wrapper = (_event: any, payload: any) => cb(payload);
      ipcRenderer.on('run:event', wrapper);
      return () => {
        ipcRenderer.removeListener('run:event', wrapper);
      };
    },
  },
});

