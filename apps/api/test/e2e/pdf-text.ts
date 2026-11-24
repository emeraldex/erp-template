/**
 * Pull the visible text out of an uncompressed PDFKit document (the API skips
 * compression when NODE_ENV=test). PDFKit writes standard-font text as hex
 * strings inside TJ arrays; one TJ block is one line of text.
 */
export function pdfLines(pdf: Buffer): string[] {
  const src = pdf.toString('latin1');
  const lines: string[] = [];
  for (const m of src.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    let line = '';
    for (const part of m[1].matchAll(/<([0-9a-fA-F]*)>|(-?\d+(?:\.\d+)?)/g)) {
      if (part[1] !== undefined) line += Buffer.from(part[1], 'hex').toString('latin1');
      else if (Number(part[2]) < -200) line += ' '; // kerning gap wide enough to be a space
    }
    lines.push(line);
  }
  return lines;
}

export const pdfPageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
