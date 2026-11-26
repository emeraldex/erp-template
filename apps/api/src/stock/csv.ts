/**
 * A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and
 * line breaks inside quotes, CRLF or LF, an optional UTF-8 BOM. Also accepts
 * semicolons when the header row has no commas (spreadsheets set to a locale
 * that uses a decimal comma save files that way).
 */
const BOM = /^\uFEFF/;

/** `;` when the header row has semicolons and no commas, otherwise `,`. */
export function csvSeparator(input: string): ',' | ';' {
  const s = input.replace(BOM, '');
  const firstLine = s.slice(0, s.search(/\r?\n|$/));
  return !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
}

export function parseCsv(input: string): string[][] {
  const s = input.replace(BOM, '');
  const sep = csvSeparator(s);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === sep) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i += 1;
  }
  if (quoted) throw new Error('A quoted field is not closed');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
