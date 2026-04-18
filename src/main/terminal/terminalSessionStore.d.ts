export type PersistedTerminalData = {
    lastCwd: string | null;
    shell: string;
};
export declare function loadTerminalData(): PersistedTerminalData;
export declare function saveTerminalData(data: PersistedTerminalData): void;
