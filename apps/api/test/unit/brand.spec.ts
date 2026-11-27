import { accentProblem, contrast, imageInfo, lighten } from '../../src/settings/brand';
import { makePng } from '../e2e/fixtures';

describe('brand colour', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#c8102e', '#ffffff')).toBeCloseTo(5.88, 1);
  });

  it('accepts colours that keep white text readable and refuses the rest', () => {
    expect(accentProblem('#0b6e4f')).toBeNull();
    expect(accentProblem('#c8102e')).toBeNull();
    expect(accentProblem('#ffd400')).toMatch(/hard to read .* needs 4.5:1/);
    expect(accentProblem('red')).toMatch(/#RRGGBB/);
    expect(accentProblem(undefined)).toMatch(/#RRGGBB/);
  });

  it('derives a lighter shade', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080');
  });
});

describe('logo images', () => {
  it('reads the size of a PNG and refuses what is not PNG or JPEG', () => {
    expect(imageInfo(makePng(120, 80))).toEqual({ type: 'image/png', width: 120, height: 80 });
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(imageInfo(Buffer.from('GIF89a......'))).toBeNull();
  });

  it('reads the size of a JPEG from its frame header', () => {
    // SOI, an APP0 segment, then SOF0 with height 50 and width 200.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
    expect(imageInfo(jpeg)).toEqual({ type: 'image/jpeg', width: 200, height: 50 });
  });
});
