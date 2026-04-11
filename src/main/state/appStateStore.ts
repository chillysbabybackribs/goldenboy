import { AppState } from '../../shared/types/appState';
import { Action } from './actions';
import { appReducer } from './reducer';
import { buildInitialState, savePersistedState } from './persistence';

export type StateListener = (state: AppState) => void;

class AppStateStore {
  private state: AppState;
  private listeners: StateListener[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.state = buildInitialState();
  }

  getState(): AppState {
    return this.state;
  }

  dispatch(action: Action): void {
    this.state = appReducer(this.state, action);
    this.notifyListeners();
    this.schedulePersist();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      savePersistedState(this.state);
      this.persistTimer = null;
    }, 1000);
  }

  persistNow(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    savePersistedState(this.state);
  }
}

export const appStateStore = new AppStateStore();
