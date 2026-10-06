import { createId } from '@shared/lib/id';
import { stripRequestSecrets } from './sanitize';
import type { HistoryEntry, RequestSpec } from './types';

export const HISTORY_LIMIT = 200;

export function createHistoryEntry(
  request: RequestSpec,
  outcome: {
    status?: number;
    statusText?: string;
    durationMs?: number;
    sizeBytes?: number;
    error?: string;
  },
  timestamp = Date.now(),
): HistoryEntry {
  return {
    id: createId(),
    timestamp,
    method: request.method,
    url: request.url,
    request: stripRequestSecrets(structuredClone(request)),
    ...outcome,
  };
}

/** Newest first, capped at `limit` entries. */
export function addToHistory(
  entries: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
): {
  entries: HistoryEntry[];
  evicted: HistoryEntry[];
} {
  const all = [entry, ...entries].sort((a, b) => b.timestamp - a.timestamp);
  return { entries: all.slice(0, limit), evicted: all.slice(limit) };
}

export function groupHistoryByDay(
  entries: HistoryEntry[],
  now = Date.now(),
): Array<{ label: string; entries: HistoryEntry[] }> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = today - 86_400_000;
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const label =
      entry.timestamp >= today
        ? 'Today'
        : entry.timestamp >= yesterday
          ? 'Yesterday'
          : new Date(entry.timestamp).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  return [...groups.entries()].map(([label, list]) => ({ label, entries: list }));
}
