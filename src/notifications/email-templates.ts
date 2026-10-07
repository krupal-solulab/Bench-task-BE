import { join } from 'path';
import { renderFile } from 'ejs';

/** EJS email templates live next to this file (copied into dist by nest-cli's `assets`). */
export const EMAIL_TEMPLATES_DIR = join(__dirname, 'templates');

/** Renders `templates/<name>.ejs`. Every value is HTML-escaped by the templates' `<%= %>` tags. */
export function renderEmailTemplate(name: string, data: Record<string, unknown>): Promise<string> {
  return renderFile(join(EMAIL_TEMPLATES_DIR, `${name}.ejs`), data, { cache: true });
}
