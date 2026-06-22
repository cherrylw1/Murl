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
    getState: () => ipcRenderer.invoke('runs:getState'),
    onEvent: (cb: (e: any) => void) => {
      const wrapper = (_event: any, payload: any) => cb(payload);
      ipcRenderer.on('run:event', wrapper);
      return () => {
        ipcRenderer.removeListener('run:event', wrapper);
      };
    },
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    get: (runId: string) => ipcRenderer.invoke('history:get', runId),
  },
  repo: {
    add: (name: string, path: string) => ipcRenderer.invoke('repo:add', name, path),
    list: () => ipcRenderer.invoke('repo:list'),
    remove: (id: string) => ipcRenderer.invoke('repo:remove', id),
  },
  tasks: {
    start: (input: { prompt: string; workspaceId: string; repoPath: string }) =>
      ipcRenderer.invoke('task:start', input),
    cancel: (input: { taskId: string; repoPath: string }) =>
      ipcRenderer.invoke('task:cancel', input),
    getState: () => ipcRenderer.invoke('tasks:getState'),
    onEvent: (cb: (e: any) => void) => {
      const wrapper = (_event: any, payload: any) => cb(payload);
      ipcRenderer.on('task:event', wrapper);
      return () => {
        ipcRenderer.removeListener('task:event', wrapper);
      };
    },
  },
});

