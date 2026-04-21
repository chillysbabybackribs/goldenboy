import { BrowserSettings, createDefaultSettings } from '../../shared/types/browser';
import { loadSettings, saveSettings } from './browserSessionStore';

export class BrowserSettingsService {
  private settings: BrowserSettings = createDefaultSettings();

  load(): BrowserSettings {
    this.settings = loadSettings();
    return this.get();
  }

  get(): BrowserSettings {
    return { ...this.settings };
  }

  update(partial: Partial<BrowserSettings>): BrowserSettings {
    this.settings = { ...this.settings, ...partial };
    saveSettings(this.settings);
    return this.get();
  }
}

