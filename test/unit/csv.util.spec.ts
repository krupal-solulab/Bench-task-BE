import { buildCsv, parseCsv } from 'src/modules/import-export/csv.util';

describe('parseCsv', () => {
  it('parses a simple two-row CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('title,notes\n"Fix, then ship",ok')).toEqual([
      ['title', 'notes'],
      ['Fix, then ship', 'ok'],
    ]);
  });

  it('handles a quoted field containing an embedded newline', () => {
    expect(parseCsv('title,notes\n"line one\nline two",ok')).toEqual([
      ['title', 'notes'],
      ['line one\nline two', 'ok'],
    ]);
  });

  it('un-escapes a doubled quote inside a quoted field', () => {
    expect(parseCsv('title\n"She said ""hi"""')).toEqual([['title'], ['She said "hi"']]);
  });

  it('treats an unquoted empty field as an empty string, not a dropped column', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('ignores a single trailing blank line', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('buildCsv', () => {
  it('joins rows with CRLF and fields with commas', () => {
    expect(
      buildCsv([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\r\n1,2');
  });

  it('quotes a field containing a comma', () => {
    expect(buildCsv([['Fix, then ship']])).toBe('"Fix, then ship"');
  });

  it('quotes and doubles an embedded quote', () => {
    expect(buildCsv([['She said "hi"']])).toBe('"She said ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    expect(buildCsv([['line one\nline two']])).toBe('"line one\nline two"');
  });

  it('round-trips through parseCsv', () => {
    const original = [
      ['title', 'notes'],
      ['Fix, then ship', 'She said "hi"'],
      ['Multi\nline', 'plain'],
    ];
    expect(parseCsv(buildCsv(original))).toEqual(original);
  });
});
