// Page range parsing ("1-3, 5, 8-") and split plans. Page numbers in strings are 1-based;
// returned indices are 0-based.

export function parsePageRanges(input: string, pageCount: number): number[][] {
  const text = input.trim();
  if (!text) throw new Error('Enter page ranges such as "1-3, 5, 8-".');
  const groups: number[][] = [];
  for (const rawPart of text.split(/[,;]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const match = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!match || (match[1] === '' && match[2] === undefined))
      throw new Error(`"${part}" is not a page or range.`);
    const isRange = part.includes('-');
    const start = match[1] === '' ? 1 : Number(match[1]);
    const end = isRange
      ? match[2] === '' || match[2] === undefined
        ? pageCount
        : Number(match[2])
      : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      throw new Error(`"${part}" is outside the document (1–${pageCount}).`);
    }
    const group: number[] = [];
    if (start <= end) for (let i = start; i <= end; i++) group.push(i - 1);
    else for (let i = start; i >= end; i--) group.push(i - 1);
    groups.push(group);
  }
  if (!groups.length) throw new Error('No pages selected.');
  return groups;
}

export type SplitMode =
  { kind: 'every'; size: number } | { kind: 'ranges'; ranges: string } | { kind: 'single' };

export function splitPlan(pageCount: number, mode: SplitMode): number[][] {
  if (pageCount < 1) return [];
  switch (mode.kind) {
    case 'single':
      return Array.from({ length: pageCount }, (_, i) => [i]);
    case 'every': {
      const size = Math.max(1, Math.floor(mode.size));
      const groups: number[][] = [];
      for (let start = 0; start < pageCount; start += size) {
        groups.push(Array.from({ length: Math.min(size, pageCount - start) }, (_, i) => start + i));
      }
      return groups;
    }
    case 'ranges':
      return parsePageRanges(mode.ranges, pageCount);
  }
}

/** Compact description of indices, e.g. [0,1,2,4] → "1-3, 5". */
export function describePages(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start + 1}` : `${start + 1}-${sorted[i] + 1}`);
  }
  return parts.join(', ');
}
