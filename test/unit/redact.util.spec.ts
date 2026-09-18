import { capForLog, redactSensitiveFields, sanitizeForLog } from 'src/modules/api-logs/redact.util';

describe('redactSensitiveFields', () => {
  it('passes primitives through unchanged', () => {
    expect(redactSensitiveFields('hello')).toBe('hello');
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(true)).toBe(true);
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it('redacts a top-level password field', () => {
    expect(redactSensitiveFields({ email: 'a@a.com', password: 'hunter2' })).toEqual({
      email: 'a@a.com',
      password: '[REDACTED]',
    });
  });

  it('is case-insensitive and matches a substring (newPassword, confirmPassword)', () => {
    expect(
      redactSensitiveFields({ newPassword: 'x', ConfirmPassword: 'y', PASSWORD: 'z' }),
    ).toEqual({ newPassword: '[REDACTED]', ConfirmPassword: '[REDACTED]', PASSWORD: '[REDACTED]' });
  });

  it('redacts token/secret/authorization/apiKey-shaped keys', () => {
    expect(
      redactSensitiveFields({
        accessToken: 'a',
        refreshToken: 'b',
        clientSecret: 'c',
        Authorization: 'd',
        apiKey: 'e',
        api_key: 'f',
      }),
    ).toEqual({
      accessToken: '[REDACTED]',
      refreshToken: '[REDACTED]',
      clientSecret: '[REDACTED]',
      Authorization: '[REDACTED]',
      apiKey: '[REDACTED]',
      api_key: '[REDACTED]',
    });
  });

  it('recurses into nested objects', () => {
    expect(redactSensitiveFields({ user: { email: 'a@a.com', password: 'x' } })).toEqual({
      user: { email: 'a@a.com', password: '[REDACTED]' },
    });
  });

  it('recurses into arrays of objects', () => {
    expect(redactSensitiveFields([{ password: 'x' }, { email: 'a@a.com' }])).toEqual([
      { password: '[REDACTED]' },
      { email: 'a@a.com' },
    ]);
  });

  it('leaves a non-sensitive field containing "pass" as a substring of another word untouched if it truly is unrelated', () => {
    // "class" doesn't match any sensitive pattern - sanity check the matcher isn't overly broad.
    expect(redactSensitiveFields({ class: 'P1' })).toEqual({ class: 'P1' });
  });
});

describe('capForLog', () => {
  it('passes small values through unchanged', () => {
    expect(capForLog({ a: 1 }, 8192)).toEqual({ a: 1 });
  });

  it('passes null/undefined through unchanged', () => {
    expect(capForLog(null)).toBeNull();
    expect(capForLog(undefined)).toBeUndefined();
  });

  it('truncates a value larger than the cap', () => {
    const big = { data: 'x'.repeat(100) };
    const result = capForLog(big, 50) as { truncated: boolean; preview: string };
    expect(result.truncated).toBe(true);
    expect(result.preview.endsWith('…[truncated]')).toBe(true);
    expect(result.preview.length).toBeLessThan(JSON.stringify(big).length);
  });
});

describe('sanitizeForLog', () => {
  it('redacts then caps in one call', () => {
    const result = sanitizeForLog({ password: 'secret', email: 'a@a.com' });
    expect(result).toEqual({ password: '[REDACTED]', email: 'a@a.com' });
  });

  it('a redacted large payload is still capped', () => {
    const big = { password: 'x', data: 'y'.repeat(100) };
    const result = sanitizeForLog(big, 50) as { truncated: boolean; preview: string };
    expect(result.truncated).toBe(true);
    // The redacted marker, not the raw secret, is what would appear in the truncated preview.
    expect(result.preview).not.toContain('"password":"x"');
  });

  // Regression: a controller can return a raw Mongoose document nested in the payload (e.g.
  // auth.service.ts's `login()` returns `{ ...tokens, user }` where `user` is a live
  // `UserDocument`, not a plain object). `redactSensitiveFields` alone can't see into it - only
  // `sanitizeForLog`'s flatten-then-redact ordering does, by forcing the document's own `toJSON`
  // to run (which is also where `User`'s schema strips `passwordHash`) before the redaction walk.
  it('redacts a sensitive field nested inside a class instance (e.g. a Mongoose document), not just plain object literals', () => {
    class FakeDocument {
      email = 'a@a.com';
      passwordHash = '$2b$12$shouldneverbepersisted';
      toJSON() {
        return { email: this.email, passwordHash: this.passwordHash };
      }
    }
    const result = sanitizeForLog({ accessToken: 'abc', user: new FakeDocument() });
    expect(result).toEqual({
      accessToken: '[REDACTED]',
      user: { email: 'a@a.com', passwordHash: '[REDACTED]' },
    });
  });

  it('still renders a Date as its normal ISO string, not an empty object (regression guard for the fix above)', () => {
    const result = sanitizeForLog({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(result).toEqual({ createdAt: '2026-01-01T00:00:00.000Z' });
  });
});
