import { parseCsv } from '../../src/stock/csv';

describe('parseCsv', () => {
  it('reads plain rows with CRLF or LF', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('handles quotes, doubled quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('name,note\n"Filter, oil","He said ""ok""\nthen left"\n')).toEqual([
      ['name', 'note'], ['Filter, oil', 'He said "ok"\nthen left'],
    ]);
  });

  it('drops a byte-order mark and blank lines, and keeps empty fields', () => {
    expect(parseCsv('\uFEFFa,b,c\n\n1,,3\n,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });

  it('accepts semicolons when the header has no commas', () => {
    expect(parseCsv('partNo;qty\nP-1;2,5')).toEqual([['partNo', 'qty'], ['P-1', '2,5']]);
  });

  it('refuses an unclosed quote', () => {
    expect(() => parseCsv('a\n"open')).toThrow('A quoted field is not closed');
  });
});
