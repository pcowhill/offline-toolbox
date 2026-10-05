// Word-wrapping shared by the on-screen preview and PDF export so both break lines identically.

export type MeasureText = (text: string) => number;

export const LINE_HEIGHT = 1.2;
export const TEXT_PADDING = 2;

/** Splits text into lines that fit `maxWidth` (explicit newlines are kept). */
export function wrapText(text: string, maxWidth: number, measure: MeasureText): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (measure(candidate.trimEnd()) <= maxWidth || line === '') {
        // A single word longer than the line is broken by characters.
        if (line === '' && measure(word) > maxWidth && word.trim()) {
          let chunk = '';
          for (const ch of word) {
            if (measure(chunk + ch) > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
