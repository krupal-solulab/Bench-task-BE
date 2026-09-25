import { extractMentionedUserIds } from 'src/modules/comments/mention.util';

describe('extractMentionedUserIds', () => {
  it('returns an empty array for a body with no mentions', () => {
    expect(extractMentionedUserIds('Looks good, ready for review.')).toEqual([]);
  });

  it('extracts a single mention', () => {
    const body = 'Hey @[Jane Doe](507f1f77bcf86cd799439011), can you take a look?';
    expect(extractMentionedUserIds(body)).toEqual(['507f1f77bcf86cd799439011']);
  });

  it('extracts multiple distinct mentions in order of first appearance', () => {
    const body =
      '@[Jane Doe](507f1f77bcf86cd799439011) and @[John Smith](507f1f77bcf86cd799439012) please review';
    expect(extractMentionedUserIds(body)).toEqual([
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
    ]);
  });

  it('de-duplicates the same user mentioned more than once', () => {
    const body =
      '@[Jane Doe](507f1f77bcf86cd799439011) ping @[Jane Doe](507f1f77bcf86cd799439011) again';
    expect(extractMentionedUserIds(body)).toEqual(['507f1f77bcf86cd799439011']);
  });

  it('ignores malformed mention-like text (not a valid 24-char hex id)', () => {
    expect(extractMentionedUserIds('@[Jane Doe](not-an-id)')).toEqual([]);
  });

  it('ignores a bare @ with no bracket markup', () => {
    expect(extractMentionedUserIds('email me @ jane@example.com')).toEqual([]);
  });
});
