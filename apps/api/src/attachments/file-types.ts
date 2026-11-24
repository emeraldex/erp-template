/** Allowed upload types. Types we can recognise by their first bytes must match them. */
const ALLOWED: Record<string, { ext: string[]; magic?: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: ['png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: ['webp'], magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  'image/tiff': { ext: ['tif', 'tiff'], magic: (b) => ['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1')) },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  'text/csv': { ext: ['csv'] },
  'text/plain': { ext: ['txt'] },
};

export const ALLOWED_TYPES = Object.keys(ALLOWED);

/** Returns an error message, or null if the file is acceptable. */
export function checkFileType(filename: string, contentType: string, body: Buffer): string | null {
  const type = ALLOWED[contentType];
  if (!type) return `File type ${contentType || 'unknown'} is not allowed. Allowed: PDF, PNG, JPEG, WebP, TIFF, XLSX, DOCX, CSV, TXT.`;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (!type.ext.includes(ext)) return `File name extension ".${ext}" does not match type ${contentType}`;
  if (type.magic && !type.magic(body)) return `File contents are not a valid ${type.ext[0].toUpperCase()}`;
  if (contentType.startsWith('text/') && body.includes(0)) return 'Text file contains binary data';
  return null;
}

/**
 * Multer (busboy) decodes multipart file names as Latin-1, but browsers send
 * UTF-8, so "é" arrives as "Ã©". Re-decode when the bytes form valid UTF-8.
 */
export function decodeUploadName(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('\ufffd') ? name : utf8;
}

/** Display-safe file name: no paths, control characters or quotes; bounded length. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '_').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(-120);
}
