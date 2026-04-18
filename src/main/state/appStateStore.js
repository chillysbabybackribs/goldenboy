"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appStateStore = void 0;
const reducer_1 = require("./reducer");
const persistence_1 = require("./persistence");
class AppStateStore {
    state;
    listeners = [];
    persistTimer = null;
    constructor() {
        this.state = (0, persistence_1.buildInitialState)();
    }
    getState() {
        return this.state;
    }
    dispatch(action) {
        this.state = (0, reducer_1.appReducer)(this.state, action);
        this.notifyListeners();
        this.schedulePersist();
    }
    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }
    notifyListeners() {
        const snapshot = this.state;
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
    schedulePersist() {
        if (this.persistTimer)
            clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            (0, persistence_1.savePersistedState)(this.state);
            this.persistTimer = null;
        }, 1000);
    }
    persistNow() {
        if (this.persistTimer)
            clearTimeout(this.persistTimer);
        (0, persistence_1.savePersistedState)(this.state);
    }
}
exports.appStateStore = new AppStateStore();
//# sourceMappingURL=appStateStore.js.map