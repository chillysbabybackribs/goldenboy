import { AppEventType, AppEventPayloads, AppEvent } from '../../shared/types/events';

type EventHandler<T extends AppEventType> = (event: AppEvent<T>) => void;
type AnyEventHandler = (event: AppEvent) => void;

export class EventBus {
  private handlers: Map<AppEventType, Set<EventHandler<any>>> = new Map();
  private globalHandlers: Set<AnyEventHandler> = new Set();

  on<T extends AppEventType>(type: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onAny(handler: AnyEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  emit<T extends AppEventType>(type: T, payload: AppEventPayloads[T]): void {
    const event: AppEvent<T> = {
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
      handler(event as AppEvent);
    }
  }

  removeAll(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}

export const eventBus = new EventBus();
