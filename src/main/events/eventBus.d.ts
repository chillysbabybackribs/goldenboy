import { AppEventType, AppEventPayloads, AppEvent } from '../../shared/types/events';
type EventHandler<T extends AppEventType> = (event: AppEvent<T>) => void;
type AnyEventHandler = (event: AppEvent) => void;
export declare class EventBus {
    private handlers;
    private globalHandlers;
    on<T extends AppEventType>(type: T, handler: EventHandler<T>): () => void;
    onAny(handler: AnyEventHandler): () => void;
    emit<T extends AppEventType>(type: T, payload: AppEventPayloads[T]): void;
    removeAll(): void;
}
export declare const eventBus: EventBus;
export {};
