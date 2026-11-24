import { integerInWords, ringgitInWords } from '../../src/documents/words';
import { pdfText } from '../../src/documents/pdf';

describe('amount in words', () => {
  it.each([
    [0, 'zero'], [7, 'seven'], [19, 'nineteen'], [21, 'twenty-one'], [100, 'one hundred'],
    [105, 'one hundred and five'], [1000, 'one thousand'], [24804, 'twenty-four thousand eight hundred and four'],
    [1_000_001, 'one million one'], [436720, 'four hundred and thirty-six thousand seven hundred and twenty'],
  ])('%d → %s', (n, words) => expect(integerInWords(n)).toBe(words));

  it('writes ringgit and sen the way Malaysian invoices do', () => {
    expect(ringgitInWords(24804)).toBe('Ringgit Malaysia Twenty-Four Thousand Eight Hundred and Four Only');
    expect(ringgitInWords(1308.64)).toBe('Ringgit Malaysia One Thousand Three Hundred and Eight and Sen Sixty-Four Only');
    expect(ringgitInWords(0.5)).toBe('Ringgit Malaysia Zero and Sen Fifty Only');
  });

  it('rejects amounts it cannot spell', () => {
    expect(() => integerInWords(-1)).toThrow(RangeError);
    expect(() => integerInWords(1.5)).toThrow(RangeError);
  });
});

describe('pdfText', () => {
  it('replaces characters the built-in PDF fonts cannot draw', () => {
    expect(pdfText('MRA → CPU (Finance)')).toBe('MRA -> CPU (Finance)');
    expect(pdfText('≤ 3 days')).toBe('<= 3 days');
    expect(pdfText('Café — ok · fine')).toBe('Café — ok · fine');
    expect(pdfText('漢字')).toBe('??');
    expect(pdfText(undefined)).toBe('');
  });
});
