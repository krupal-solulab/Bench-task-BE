/**
 * A minimal, dependency-free RFC 4180-lite CSV reader/writer for Module 5's task import/export -
 * hand-rolled rather than pulling in a CSV library, since the column set is small and fixed and
 * this codebase's own convention (Gantt/rich-text/LLM libraries all deliberately avoided
 * elsewhere) favors a small pure function over a new dependency when the format is this bounded.
 * Handles double-quoted fields (with embedded commas, quotes doubled as `""`, and embedded
 * newlines) and both `\n`/`\r\n` line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = '';
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // A trailing row with no final newline still counts, but a file ending exactly on a newline
  // (field === '' and row === [] and nothing pending) must not add a phantom empty row.
  if (field !== '' || row.length > 0) {
    endRow();
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}
