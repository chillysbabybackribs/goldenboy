import type { IpcMainInvokeEvent } from 'electron';
type SafeHandle = <TEventArgs extends unknown[], TResult>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: TEventArgs) => Promise<TResult> | TResult) => void;
export declare function registerArtifactIpc(safeHandle: SafeHandle): void;
export {};
