/** Masks the `user:password@` portion of a Mongo connection string before it's ever logged. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^/@]+@/, '//[REDACTED]@');
}
