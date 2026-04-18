/** Format a timestamp as HH:MM:SS (24-hour). */
export declare function formatTime(ts: number): string;
/** Format a timestamp as HH:MM (24-hour, no seconds). */
export declare function formatTimeShort(ts: number): string;
/** Format a timestamp as "Mon DD" short date. */
export declare function formatDate(ts: number): string;
/** Format a nullable timestamp as "Mon DD HH:MM" or "Never". */
export declare function formatNullableTime(ts: number | null): string;
/** Escape a string for safe HTML insertion. */
export declare function escapeHtml(str: string): string;
