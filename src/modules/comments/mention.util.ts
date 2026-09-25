/**
 * Module 7's @mention convention: the frontend's mention picker inserts `@[Display Name](userId)`
 * into the comment body at the point of selection - a lightweight markup that needs no rich-text
 * editor (mirrors the same "plain string + inline convention" approach this codebase already uses
 * elsewhere rather than adding a new editor dependency). Mentioned user ids are derived from the
 * PERSISTED body text server-side (not trusted as a separate client-supplied field), so the stored
 * `mentionedUserIds` can never diverge from what the comment text actually displays.
 */
const MENTION_PATTERN = /@\[[^\]]+\]\(([a-f0-9]{24})\)/g;

export function extractMentionedUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    ids.add(match[1]!);
  }
  return [...ids];
}
