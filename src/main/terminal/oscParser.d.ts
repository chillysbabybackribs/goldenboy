export type OscEvent = {
    type: 'command-started';
} | {
    type: 'prompt-started';
} | {
    type: 'exit-code';
    code: number;
} | {
    type: 'cwd';
    path: string;
};
export type ParseResult = {
    cleaned: string;
    events: OscEvent[];
    parts: Array<{
        type: 'text';
        value: string;
    } | {
        type: 'event';
        event: OscEvent;
    }>;
};
export declare function parseOscSequences(data: string): ParseResult;
export declare function stripAnsi(text: string): string;
