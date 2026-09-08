import { Types } from 'mongoose';

/**
 * Mongoose typings don't reflect that a `populate()`d ref becomes a hydrated document at runtime,
 * so refs are still typed as `ObjectId`. This safely extracts the id string from either shape.
 *
 * `Types.ObjectId` is checked first and explicitly, because a raw ObjectId instance has its own
 * internal `id` property (the 12-byte buffer) — the naive `'id' in value` duck-type check below
 * would match that and stringify the raw bytes instead of the hex id.
 */
export function extractId(value: unknown): string {
  if (value instanceof Types.ObjectId) {
    return value.toString();
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id);
  }
  return String(value);
}
