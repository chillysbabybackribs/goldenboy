import { AppState } from '../../shared/types/appState';
import { Action } from './actions';
export type StateListener = (state: AppState) => void;
declare class AppStateStore {
    private state;
    private listeners;
    private persistTimer;
    constructor();
    getState(): AppState;
    dispatch(action: Action): void;
    subscribe(listener: StateListener): () => void;
    private notifyListeners;
    private schedulePersist;
    persistNow(): void;
}
export declare const appStateStore: AppStateStore;
export {};
