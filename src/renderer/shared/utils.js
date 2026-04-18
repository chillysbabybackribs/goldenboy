"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTime = formatTime;
exports.formatTimeShort = formatTimeShort;
exports.formatDate = formatDate;
exports.formatNullableTime = formatNullableTime;
exports.escapeHtml = escapeHtml;
/** Format a timestamp as HH:MM:SS (24-hour). */
function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
/** Format a timestamp as HH:MM (24-hour, no seconds). */
function formatTimeShort(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
/** Format a timestamp as "Mon DD" short date. */
function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
/** Format a nullable timestamp as "Mon DD HH:MM" or "Never". */
function formatNullableTime(ts) {
    return typeof ts === 'number' ? `${formatDate(ts)} ${formatTimeShort(ts)}` : 'Never';
}
/** Escape a string for safe HTML insertion. */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
//# sourceMappingURL=utils.js.map