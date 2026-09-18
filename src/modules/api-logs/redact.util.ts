/**
 * Request/response payload sanitization for the Audit Log (Role-surface polish) - pure and
 * side-effect-free so it's exhaustively unit-testable. Used by ApiLogInterceptor before a
 * payload is ever persisted, never after.
 */

const REDACTED = '[REDACTED]';
const TRUNCATED_SUFFIX = '…[truncated]';

// Case-insensitive substring match against the key name - catches `password`, `newPassword`,
// `x-api-key`, `Authorization`, `refreshToken`, etc. without needing an exhaustive exact list.
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively replaces any object value whose key looks sensitive with a fixed redaction marker.
 * Arrays are walked element-by-element; primitives and non-plain-object values (Date, etc.) pass
 * through unchanged since they can't carry a "key". Only ever called on the output of
 * `toPlainJson` below - a live Mongoose document's own enumerable data lives behind its
 * prototype's `toJSON`, so recursing into it directly here (before that transform has run) would
 * silently skip whatever it hides (e.g. `User`'s own `passwordHash`-stripping transform).
 */
export function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item));
  }
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveFields(val);
    }
    return result;
  }
  return value;
}

/**
 * Flattens a controller's raw return value into plain, JSON-safe data by round-tripping it
 * through `JSON.stringify`/`JSON.parse`. This is what actually turns a live Mongoose document
 * (which `redactSensitiveFields` above can't see into) into a plain object - `JSON.stringify`
 * invokes the document's own `toJSON()`, which is where `User`'s schema-level transform deletes
 * `passwordHash` before this ever reaches persistence. Also turns `Date`s into ISO strings the
 * same way the real HTTP response would.
 */
function toPlainJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

/**
 * Bounds how much of a payload gets persisted in a log document - a large request/response body
 * (e.g. a file upload, a big list response) is truncated rather than stored in full, since this
 * is a debugging aid, not a data backup. Expects an already-plain value (see `toPlainJson`).
 */
export function capForLog(value: unknown, maxBytes = 8192): unknown {
  if (value === null || value === undefined) return value;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return String(value);
  }
  if (json.length <= maxBytes) return value;
  return { truncated: true, preview: json.slice(0, maxBytes) + TRUNCATED_SUFFIX };
}

/** Composes flattening, redaction, then size-capping - the one entry point ApiLogInterceptor
 * calls for both the request body and the response body. Flattening must run first: it's what
 * exposes a live Mongoose document's real data (via its own `toJSON`) for redaction to see. */
export function sanitizeForLog(value: unknown, maxBytes = 8192): unknown {
  return capForLog(redactSensitiveFields(toPlainJson(value)), maxBytes);
}
