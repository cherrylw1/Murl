import { app, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ProviderId } from '@murl/engine';

export interface SettingsView {
  activeProvider: ProviderId;
  activeModel: string;
  providers: {
    openrouter: { configured: boolean };
    gemini:     { configured: boolean };
    ollama:     { baseUrl: string };
  };
}

interface StoreData {
  activeProvider: ProviderId;
  activeModels: Record<ProviderId, string>;
  keys: {
    openrouter?: string;
    gemini?: string;
  };
  ollamaBaseUrl: string;
}

export class SettingsStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'murl-settings.json');
  }

  private load(): StoreData {
    const defaultData: StoreData = {
      activeProvider: 'openrouter',
      activeModels: {
        openrouter: 'google/gemini-2.5-flash',
        gemini: 'gemini-2.5-flash',
        ollama: 'llama3',
      },
      keys: {},
      ollamaBaseUrl: 'http://localhost:11434',
    };

    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(content);
        return {
          activeProvider: parsed.activeProvider || defaultData.activeProvider,
          activeModels: {
            ...defaultData.activeModels,
            ...(parsed.activeModels || {}),
          },
          keys: parsed.keys || {},
          ollamaBaseUrl: parsed.ollamaBaseUrl || defaultData.ollamaBaseUrl,
        };
      }
    } catch (err) {
      console.error('Failed to load settings from disk, using defaults:', err);
    }
    return defaultData;
  }

  private save(data: StoreData): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save settings to disk:', err);
    }
  }

  private checkEncryptionAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron safeStorage encryption is not available on this platform.');
    }
  }

  public getSettingsView(): SettingsView {
    const data = this.load();
    const activeProvider = data.activeProvider;
    const activeModel = data.activeModels[activeProvider] || '';

    return {
      activeProvider,
      activeModel,
      providers: {
        openrouter: {
          configured: !!data.keys.openrouter,
        },
        gemini: {
          configured: !!data.keys.gemini,
        },
        ollama: {
          baseUrl: data.ollamaBaseUrl,
        },
      },
    };
  }

  public async setKey(id: ProviderId, key: string): Promise<{ ok: boolean }> {
    if (id !== 'openrouter' && id !== 'gemini') {
      throw new Error(`Cannot set API key for provider: ${id}`);
    }
    this.checkEncryptionAvailable();

    const data = this.load();
    const encrypted = safeStorage.encryptString(key);
    data.keys[id] = encrypted.toString('base64');
    this.save(data);

    return { ok: true };
  }

  public async clearKey(id: ProviderId): Promise<{ ok: boolean }> {
    if (id !== 'openrouter' && id !== 'gemini') {
      throw new Error(`Cannot clear API key for provider: ${id}`);
    }

    const data = this.load();
    delete data.keys[id];
    this.save(data);

    return { ok: true };
  }

  public async setActive(id: ProviderId, model: string): Promise<{ ok: boolean }> {
    const data = this.load();
    data.activeProvider = id;
    data.activeModels[id] = model;
    this.save(data);

    return { ok: true };
  }

  public async setOllamaBaseUrl(url: string): Promise<{ ok: boolean }> {
    const data = this.load();
    data.ollamaBaseUrl = url;
    this.save(data);

    return { ok: true };
  }

  public getDecryptedKey(id: 'openrouter' | 'gemini'): string | undefined {
    const data = this.load();
    const encryptedBase64 = data.keys[id];
    if (!encryptedBase64) {
      return undefined;
    }
    this.checkEncryptionAvailable();
    const buffer = Buffer.from(encryptedBase64, 'base64');
    return safeStorage.decryptString(buffer);
  }

  public getOllamaBaseUrl(): string {
    const data = this.load();
    return data.ollamaBaseUrl;
  }

  public getActiveModel(id: ProviderId): string {
    const data = this.load();
    return data.activeModels[id] || '';
  }
}
