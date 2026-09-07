/**
 * Mongoose typings don't reflect that a `populate()`d ref becomes a hydrated document at runtime,
 * so refs are still typed as `ObjectId`. This safely extracts the id string from either shape.
 */
export function extractId(value: unknown): string {
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id);
  }
  return String(value);
}
