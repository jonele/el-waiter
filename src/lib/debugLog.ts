/**
 * On-device debug log for Joey.
 * Captures errors, sync events, and diagnostics.
 * Viewable in Settings > Debug Log with copy-to-clipboard.
 */

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
}

const MAX_ENTRIES = 200;
const _log: LogEntry[] = [];
const _listeners: Set<() => void> = new Set();

function now(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

export function dlog(level: LogEntry["level"], msg: string) {
  _log.push({ ts: now(), level, msg });
  if (_log.length > MAX_ENTRIES) _log.shift();
  _listeners.forEach((fn) => fn());
}

export function dinfo(msg: string) { dlog("info", msg); }
export function dwarn(msg: string) { dlog("warn", msg); }
export function derror(msg: string) { dlog("error", msg); }

export function getLog(): LogEntry[] { return [..._log]; }

export function getLogText(): string {
  return _log.map((e) => `[${e.ts}] ${e.level.toUpperCase()} ${e.msg}`).join("\n");
}

export function clearLog() { _log.length = 0; _listeners.forEach((fn) => fn()); }

export function onLogChange(fn: () => void) {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// Boot entry
dinfo(`Joey boot — ${typeof window !== "undefined" ? window.location.href : "SSR"}`);
