/**
 * Brand colour and logo checks. The colour sits behind white text on buttons
 * and active menu items, so it must leave that text readable; the logo goes
 * on screens and PDFs, which take PNG and JPEG.
 */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MIN_EDGE = 64;
const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Why a brand colour cannot be used, or null if it is fine. */
export function accentProblem(hex: unknown): string | null {
  if (typeof hex !== 'string' || !HEX.test(hex)) return 'Give the colour as #RRGGBB, e.g. #0B6E4F';
  const ratio = contrast(hex, '#ffffff');
  if (ratio < 4.5) return `White text on ${hex} is hard to read (contrast ${ratio.toFixed(1)}:1, needs 4.5:1) — choose a darker colour`;
  return null;
}

/** A lighter shade for hover states: mix towards white. */
export function lighten(hex: string, amount = 0.18): string {
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * amount);
  return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

/** Width and height of a PNG or JPEG from its bytes, or null if it is neither. */
export function imageInfo(buf: Buffer): { type: 'image/png' | 'image/jpeg'; width: number; height: number } | null {
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // Start-of-frame markers carry the size (not DHT c4, JPG c8, DAC cc).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
