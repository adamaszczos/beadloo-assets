/**
 * The one CSV reader and writer for the Miyuki sources (registry, decisions, catalogue, batches,
 * sample cards): comma-separated, `"` quoting with `""` for a quote inside a field, LF or CRLF line
 * ends. A field never spans lines in these files, so a record is a line.
 */

/** One line's fields, quotes resolved. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/** The non-blank lines of a CSV, split into fields; the header is the first. */
export function readCsvLines(text: string): string[][] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '').map(splitCsvLine);
}

/** Rows keyed by the header's column names; a missing trailing field reads as `undefined`. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const [header, ...rows] = readCsvLines(text);
  if (!header) return [];
  return rows.map((cells) => Object.fromEntries(cells.map((cell, index) => [header[index], cell])));
}

/** A field as written: quoted when it holds a comma, a quote or a line break. */
export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows written under `header`, LF line ends, a trailing newline. */
export function formatCsv(rows: ReadonlyArray<Record<string, string | undefined>>, header: readonly string[]): string {
  return [header.join(','), ...rows.map((row) => header.map((column) => csvEscape(row[column] ?? '')).join(','))].join('\n') + '\n';
}
