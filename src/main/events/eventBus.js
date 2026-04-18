"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventBus = exports.EventBus = void 0;
class EventBus {
    handlers = new Map();
    globalHandlers = new Set();
    on(type, handler) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type).add(handler);
        return () => {
            this.handlers.get(type)?.delete(handler);
        };
    }
    onAny(handler) {
        this.globalHandlers.add(handler);
        return () => {
            this.globalHandlers.delete(handler);
        };
    }
    emit(type, payload) {
        const event = {
            type,
            payload,
            timestamp: Date.now(),
        };
        const handlers = this.handlers.get(type);
        if (handlers) {
            for (const handler of handlers) {
                handler(event);
            }
        }
        for (const handler of this.globalHandlers) {
            handler(event);
        }
    }
    removeAll() {
        this.handlers.clear();
        this.globalHandlers.clear();
    }
}
exports.EventBus = EventBus;
exports.eventBus = new EventBus();
//# sourceMappingURL=eventBus.js.map