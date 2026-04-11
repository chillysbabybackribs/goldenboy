/** Format a timestamp as HH:MM:SS (24-hour). */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format a timestamp as HH:MM (24-hour, no seconds). */
export function formatTimeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

/** Format a timestamp as "Mon DD" short date. */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a nullable timestamp as "Mon DD HH:MM" or "Never". */
export function formatNullableTime(ts: number | null): string {
  return typeof ts === 'number' ? `${formatDate(ts)} ${formatTimeShort(ts)}` : 'Never';
}

/** Escape a string for safe HTML insertion. */
export function escapeHtml(str: string): string {
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}
