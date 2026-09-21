import { BadRequestException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import { TaskDocument } from '../schemas/task.schema';
import { escapeRegex } from '../utils/task-filter.util';

/**
 * A bounded, JQL-lite compound query language for `GET /tasks/search` - additive alongside the
 * fixed-shape `GET /tasks` filtering (`task-filter.util.ts`), which stays untouched. Supports
 * `field operator value` clauses combined with AND/OR (AND binds tighter than OR), parentheses,
 * a `NOT (...)` prefix, and `currentUser()` (valid only for `assignee`/`createdBy`). Not building:
 * issue-history functions, `IN (...)` value lists (express as `field = a OR field = b` instead),
 * or multi-key ORDER BY (matches `buildTaskListSort`'s existing single-key constraint).
 *
 * Grammar (case-insensitive keywords; field names case-insensitive; values case-sensitive):
 *   query      := orExpr ( 'ORDER' 'BY' FIELD ( 'ASC' | 'DESC' )? )?
 *   orExpr     := andExpr ( 'OR' andExpr )*
 *   andExpr    := notExpr ( 'AND' notExpr )*
 *   notExpr    := 'NOT' notExpr | primary
 *   primary    := '(' orExpr ')' | comparison
 *   comparison := FIELD OPERATOR value
 *   value      := STRING | BAREWORD | 'currentUser' '(' ')'
 */

export const JQL_FIELDS = [
  'project',
  'status',
  'priority',
  'assignee',
  'issueType',
  'labels',
  'components',
  'createdBy',
  'dueDate',
  'text',
  'sprint',
] as const;
export type JqlField = (typeof JQL_FIELDS)[number];

/** Case-insensitive field lookup - `JQL_FIELDS` uses the actual (mixed-case) Mongo field names,
 * so matching a lowercased user-typed token requires mapping back to the canonical spelling
 * rather than assuming `.toLowerCase()` on the canonical name would equal itself. */
function buildLowerLookup<T extends string>(names: readonly T[]): Record<string, T> {
  const map: Record<string, T> = {};
  for (const name of names) map[name.toLowerCase()] = name;
  return map;
}
const JQL_FIELD_BY_LOWER = buildLowerLookup(JQL_FIELDS);

/** Valid ORDER BY fields - the same fixed list `buildTaskListSort` already accepts. */
export const JQL_SORT_FIELDS = [
  'dueDate',
  'priority',
  'status',
  'createdAt',
  'updatedAt',
  'rank',
] as const;
const JQL_SORT_FIELD_BY_LOWER = buildLowerLookup(JQL_SORT_FIELDS);

export type JqlOperator = '=' | '!=' | '~' | '>' | '>=' | '<' | '<=';

export type JqlValue =
  | { kind: 'literal'; value: string }
  | { kind: 'currentUser' }
  // `sprint = current` (valid only for `sprint`) - unlike `currentUser()`, resolving this needs an
  // async lookup of the named project's active sprint, so it can't be done inside this pure
  // compiler. The service layer substitutes it for a real sprint id (via `substituteCurrentSprint`)
  // before `compileJqlAst` ever sees it - `resolveValue` below only guards against a caller that
  // skipped that step.
  | { kind: 'currentSprint' };

export type JqlAst =
  | { type: 'and'; left: JqlAst; right: JqlAst }
  | { type: 'or'; left: JqlAst; right: JqlAst }
  | { type: 'not'; expr: JqlAst }
  | { type: 'comparison'; field: JqlField; operator: JqlOperator; value: JqlValue };

export interface JqlOrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface JqlQuery {
  ast: JqlAst;
  orderBy?: JqlOrderBy;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'ident' | 'string' | 'operator' | 'lparen' | 'rparen' | 'eof';

interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = ['!=', '>=', '<=', '=', '~', '>', '<'];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < input.length && input[j] !== quote) {
        value += input[j];
        j++;
      }
      if (j >= input.length) {
        throw new BadRequestException(`Unterminated string starting at position ${i}`);
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ type: 'operator', value: op });
      i += op.length;
      continue;
    }
    const bareMatch = /^[A-Za-z0-9_\-:.]+/.exec(input.slice(i));
    if (bareMatch) {
      tokens.push({ type: 'ident', value: bareMatch[0] });
      i += bareMatch[0].length;
      continue;
    }
    throw new BadRequestException(`Unexpected character "${ch}" at position ${i}`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === 'ident' && t.value.toUpperCase() === word;
  }

  private consumeKeyword(word: string): void {
    if (!this.isKeyword(word)) {
      throw new BadRequestException(
        `Expected "${word}" but got "${this.peek().value || 'end of query'}"`,
      );
    }
    this.pos++;
  }

  private advance(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  parse(): JqlQuery {
    const ast = this.parseOr();
    let orderBy: JqlOrderBy | undefined;
    if (this.isKeyword('ORDER')) {
      this.pos++;
      this.consumeKeyword('BY');
      const fieldToken = this.advance();
      if (fieldToken.type !== 'ident') {
        throw new BadRequestException('Expected a field name after ORDER BY');
      }
      const field = JQL_SORT_FIELD_BY_LOWER[fieldToken.value.toLowerCase()];
      if (!field) {
        throw new BadRequestException(
          `Cannot ORDER BY "${fieldToken.value}" - expected one of: ${JQL_SORT_FIELDS.join(', ')}`,
        );
      }
      let direction: 'asc' | 'desc' = 'asc';
      if (this.isKeyword('ASC')) {
        this.pos++;
      } else if (this.isKeyword('DESC')) {
        direction = 'desc';
        this.pos++;
      }
      orderBy = { field, direction };
    }
    if (this.peek().type !== 'eof') {
      throw new BadRequestException(
        `Unexpected token "${this.peek().value}" - query did not fully parse`,
      );
    }
    return { ast, orderBy };
  }

  private parseOr(): JqlAst {
    let left = this.parseAnd();
    while (this.isKeyword('OR')) {
      this.pos++;
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): JqlAst {
    let left = this.parseNot();
    while (this.isKeyword('AND')) {
      this.pos++;
      const right = this.parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }

  private parseNot(): JqlAst {
    if (this.isKeyword('NOT')) {
      this.pos++;
      return { type: 'not', expr: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): JqlAst {
    if (this.peek().type === 'lparen') {
      this.pos++;
      const inner = this.parseOr();
      if (this.peek().type !== 'rparen') {
        throw new BadRequestException('Expected a closing ")"');
      }
      this.pos++;
      return inner;
    }
    return this.parseComparison();
  }

  private parseComparison(): JqlAst {
    const fieldToken = this.advance();
    if (fieldToken.type !== 'ident') {
      throw new BadRequestException(
        `Expected a field name but got "${fieldToken.value || 'end of query'}"`,
      );
    }
    const field = JQL_FIELD_BY_LOWER[fieldToken.value.toLowerCase()];
    if (!field) {
      throw new BadRequestException(
        `Unknown field "${fieldToken.value}" - expected one of: ${JQL_FIELDS.join(', ')}`,
      );
    }

    const opToken = this.advance();
    if (opToken.type !== 'operator') {
      throw new BadRequestException(`Expected an operator after "${fieldToken.value}"`);
    }
    const operator = opToken.value as JqlOperator;

    const value = this.parseValue();
    return { type: 'comparison', field, operator, value };
  }

  private parseValue(): JqlValue {
    const token = this.advance();
    if (token.type === 'string') {
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'ident') {
      if (token.value.toLowerCase() === 'currentuser') {
        if (this.peek().type !== 'lparen') {
          throw new BadRequestException('Expected "()" after currentUser');
        }
        this.pos++;
        if (this.peek().type !== 'rparen') {
          throw new BadRequestException('currentUser() takes no arguments');
        }
        this.pos++;
        return { kind: 'currentUser' };
      }
      if (token.value.toLowerCase() === 'current') {
        return { kind: 'currentSprint' };
      }
      return { kind: 'literal', value: token.value };
    }
    throw new BadRequestException(`Expected a value but got "${token.value || 'end of query'}"`);
  }
}

export function parseJql(input: string): JqlQuery {
  if (!input.trim()) {
    throw new BadRequestException('Query cannot be empty');
  }
  return new Parser(tokenize(input)).parse();
}

// ---------------------------------------------------------------------------
// Compiler - JqlAst -> Mongo FilterQuery<TaskDocument>
// ---------------------------------------------------------------------------

const ARRAY_FIELDS: ReadonlySet<JqlField> = new Set(['labels', 'components']);
const OBJECT_ID_FIELDS: ReadonlySet<JqlField> = new Set([
  'project',
  'assignee',
  'createdBy',
  'sprint',
]);
const CURRENT_USER_FIELDS: ReadonlySet<JqlField> = new Set(['assignee', 'createdBy']);

function resolveValue(field: JqlField, value: JqlValue, actingUser: AuthenticatedUser): string {
  if (value.kind === 'currentUser') {
    if (!CURRENT_USER_FIELDS.has(field)) {
      throw new BadRequestException(`currentUser() is not valid for field "${field}"`);
    }
    return actingUser.id;
  }
  if (value.kind === 'currentSprint') {
    // Reachable only if a caller compiles an AST that skipped substituteCurrentSprint() first.
    throw new BadRequestException('"current" is not valid for field "' + field + '"');
  }
  return value.value;
}

/**
 * Walks the AST for `sprint = current`/`sprint != current` usage, and (independently) collects
 * every literal `project = <id>` comparison's value. `sprint = current` (BRD 7's "resolves to the
 * project's active sprint") is meaningless without pinning the query to exactly one project - so
 * the service layer calls this first, before compiling, to either resolve that single project's
 * active sprint or reject the query with a clear 400.
 */
export function analyzeCurrentSprintUsage(ast: JqlAst): {
  usesCurrentSprint: boolean;
  projectIds: string[];
} {
  const projectIds = new Set<string>();
  let usesCurrentSprint = false;

  function walk(node: JqlAst): void {
    switch (node.type) {
      case 'and':
      case 'or':
        walk(node.left);
        walk(node.right);
        return;
      case 'not':
        walk(node.expr);
        return;
      case 'comparison':
        if (node.field === 'sprint' && node.value.kind === 'currentSprint') {
          usesCurrentSprint = true;
        }
        if (node.field === 'project' && node.operator === '=' && node.value.kind === 'literal') {
          projectIds.add(node.value.value);
        }
        return;
    }
  }
  walk(ast);
  return { usesCurrentSprint, projectIds: [...projectIds] };
}

/** Replaces every `{kind: 'currentSprint'}` value in the AST with a resolved sprint id literal -
 * called once the service layer has looked up the single project's active sprint. */
export function substituteCurrentSprint(ast: JqlAst, sprintId: string): JqlAst {
  switch (ast.type) {
    case 'and':
      return {
        type: 'and',
        left: substituteCurrentSprint(ast.left, sprintId),
        right: substituteCurrentSprint(ast.right, sprintId),
      };
    case 'or':
      return {
        type: 'or',
        left: substituteCurrentSprint(ast.left, sprintId),
        right: substituteCurrentSprint(ast.right, sprintId),
      };
    case 'not':
      return { type: 'not', expr: substituteCurrentSprint(ast.expr, sprintId) };
    case 'comparison':
      if (ast.field === 'sprint' && ast.value.kind === 'currentSprint') {
        return { ...ast, value: { kind: 'literal', value: sprintId } };
      }
      return ast;
  }
}

function compileComparison(
  node: Extract<JqlAst, { type: 'comparison' }>,
  actingUser: AuthenticatedUser,
): FilterQuery<TaskDocument> {
  const { field, operator } = node;

  if (field === 'text') {
    if (operator !== '~') {
      throw new BadRequestException('"text" only supports the "~" (contains) operator');
    }
    const pattern = escapeRegex(resolveValue(field, node.value, actingUser));
    return {
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { description: { $regex: pattern, $options: 'i' } },
        { issueKey: { $regex: pattern, $options: 'i' } },
      ],
    };
  }

  if (operator === '~') {
    throw new BadRequestException('"~" is only supported on the "text" field');
  }

  if (field === 'dueDate') {
    const raw = resolveValue(field, node.value, actingUser);
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`"${raw}" is not a valid date for "dueDate"`);
    }
    switch (operator) {
      case '=':
        return { dueDate: date };
      case '!=':
        return { dueDate: { $ne: date } };
      case '>':
        return { dueDate: { $gt: date } };
      case '>=':
        return { dueDate: { $gte: date } };
      case '<':
        return { dueDate: { $lt: date } };
      case '<=':
        return { dueDate: { $lte: date } };
    }
  }

  if (operator === '>' || operator === '>=' || operator === '<' || operator === '<=') {
    throw new BadRequestException(`"${operator}" is only supported on the "dueDate" field`);
  }

  const raw = resolveValue(field, node.value, actingUser);
  const resolved: string | Types.ObjectId = OBJECT_ID_FIELDS.has(field)
    ? new Types.ObjectId(raw)
    : raw;

  if (ARRAY_FIELDS.has(field)) {
    // Array membership - "contains"/"does not contain", matching buildTaskListFilter's own
    // $in-based reading of these fields (a single value here is equivalent to a one-element $in).
    return operator === '=' ? { [field]: resolved } : { [field]: { $ne: resolved } };
  }

  return operator === '=' ? { [field]: resolved } : { [field]: { $ne: resolved } };
}

export function compileJqlAst(
  ast: JqlAst,
  actingUser: AuthenticatedUser,
): FilterQuery<TaskDocument> {
  switch (ast.type) {
    case 'and':
      return { $and: [compileJqlAst(ast.left, actingUser), compileJqlAst(ast.right, actingUser)] };
    case 'or':
      return { $or: [compileJqlAst(ast.left, actingUser), compileJqlAst(ast.right, actingUser)] };
    case 'not':
      return { $nor: [compileJqlAst(ast.expr, actingUser)] };
    case 'comparison':
      return compileComparison(ast, actingUser);
  }
}

/**
 * Defense-in-depth re-check that an `orderBy.field` is one of the allowed sort fields - the
 * parser already canonicalizes and validates this at parse time (see `Parser.parse()`), so this
 * only ever throws for an `orderBy` built some other way than `parseJql()`.
 */
export function assertValidJqlOrderBy(orderBy: JqlOrderBy | undefined): void {
  if (!orderBy) return;
  if (!(JQL_SORT_FIELDS as readonly string[]).includes(orderBy.field)) {
    throw new BadRequestException(
      `Cannot ORDER BY "${orderBy.field}" - expected one of: ${JQL_SORT_FIELDS.join(', ')}`,
    );
  }
}
