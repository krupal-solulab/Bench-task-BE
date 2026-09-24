import { BadRequestException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import { TaskDocument } from '../schemas/task.schema';
import { escapeRegex } from '../utils/task-filter.util';

/**
 * A bounded, JQL-lite compound query language for `GET /tasks/search` - additive alongside the
 * fixed-shape `GET /tasks` filtering (`task-filter.util.ts`), which stays untouched. Supports
 * `field operator value` clauses combined with AND/OR (AND binds tighter than OR), parentheses,
 * a `NOT (...)` prefix, `IN (...)`/`NOT IN (...)` value lists (Module 4's "real JQL engine" -
 * previously deferred in favor of `field = a OR field = b`), multi-key `ORDER BY`, and
 * `currentUser()` (valid only for `assignee`/`createdBy`). Not building: issue-history functions.
 *
 * Grammar (case-insensitive keywords; field names case-insensitive; values case-sensitive):
 *   query      := orExpr ( 'ORDER' 'BY' orderTerm ( ',' orderTerm )* )?
 *   orderTerm  := FIELD ( 'ASC' | 'DESC' )?
 *   orExpr     := andExpr ( 'OR' andExpr )*
 *   andExpr    := notExpr ( 'AND' notExpr )*
 *   notExpr    := 'NOT' notExpr | primary
 *   primary    := '(' orExpr ')' | comparison
 *   comparison := FIELD OPERATOR value | FIELD ( 'IN' | 'NOT' 'IN' ) '(' value ( ',' value )* ')'
 *   value      := STRING | BAREWORD | 'currentUser' '(' ')'
 */

export const JQL_FIELDS = [
  'project',
  'status',
  'statusCategory',
  'priority',
  'assignee',
  'issueType',
  'labels',
  'components',
  'createdBy',
  'dueDate',
  'text',
  'sprint',
  'storyPoints',
  'parent',
  'fixVersions',
  'affectsVersions',
  'issueKey',
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

/** Valid ORDER BY fields - a superset of `buildTaskListSort`'s own single-key list, since JQL's
 * ORDER BY is compiled independently (see `buildJqlSort` below), not routed through that helper. */
export const JQL_SORT_FIELDS = [
  'dueDate',
  'priority',
  'status',
  'createdAt',
  'updatedAt',
  'rank',
  'storyPoints',
] as const;
const JQL_SORT_FIELD_BY_LOWER = buildLowerLookup(JQL_SORT_FIELDS);

export type JqlOperator = '=' | '!=' | '~' | '>' | '>=' | '<' | '<=' | 'in' | 'not in';

/** A single value - what a scalar comparison's right-hand side resolves to, and what each element
 * of an `IN (...)` list is. Deliberately excludes `list` itself - an `IN` list of lists makes no
 * sense, and keeping `resolveValue` typed against this (not the wider `JqlValue`) is what makes
 * that exclusion enforced by the compiler, not just documented. */
export type JqlScalarValue =
  | { kind: 'literal'; value: string }
  | { kind: 'currentUser' }
  // `sprint = current` (valid only for `sprint`) - unlike `currentUser()`, resolving this needs an
  // async lookup of the named project's active sprint, so it can't be done inside this pure
  // compiler. The service layer substitutes it for a real sprint id (via `substituteCurrentSprint`)
  // before `compileJqlAst` ever sees it - `resolveValue` below only guards against a caller that
  // skipped that step.
  | { kind: 'currentSprint' };

export type JqlValue = JqlScalarValue | { kind: 'list'; values: JqlScalarValue[] };

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
  /** One entry per comma-separated ORDER BY term, in the order given - Mongo sort objects are
   * themselves key-ordered, so this array's order directly becomes tie-break precedence. */
  orderBy?: JqlOrderBy[];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'ident' | 'string' | 'operator' | 'lparen' | 'rparen' | 'comma' | 'eof';

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
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
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
    let orderBy: JqlOrderBy[] | undefined;
    if (this.isKeyword('ORDER')) {
      this.pos++;
      this.consumeKeyword('BY');
      orderBy = [this.parseOrderTerm()];
      while (this.peek().type === 'comma') {
        this.pos++;
        orderBy.push(this.parseOrderTerm());
      }
    }
    if (this.peek().type !== 'eof') {
      throw new BadRequestException(
        `Unexpected token "${this.peek().value}" - query did not fully parse`,
      );
    }
    return { ast, orderBy };
  }

  private parseOrderTerm(): JqlOrderBy {
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
    return { field, direction };
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

    // IN / NOT IN - checked before the generic OPERATORS token set, since 'IN'/'NOT' tokenize as
    // plain idents (keywords), not operators.
    let negatedIn = false;
    if (
      this.isKeyword('NOT') &&
      this.tokens[this.pos + 1]?.type === 'ident' &&
      this.tokens[this.pos + 1]!.value.toUpperCase() === 'IN'
    ) {
      negatedIn = true;
      this.pos += 2;
    } else if (this.isKeyword('IN')) {
      this.pos += 1;
    } else {
      const opToken = this.advance();
      if (opToken.type !== 'operator') {
        throw new BadRequestException(`Expected an operator after "${fieldToken.value}"`);
      }
      const operator = opToken.value as JqlOperator;
      const value = this.parseValue();
      return { type: 'comparison', field, operator, value };
    }

    if (this.peek().type !== 'lparen') {
      throw new BadRequestException(`Expected "(" after ${negatedIn ? 'NOT IN' : 'IN'}`);
    }
    this.pos++;
    const values: JqlScalarValue[] = [this.parseValue()];
    while (this.peek().type === 'comma') {
      this.pos++;
      values.push(this.parseValue());
    }
    if (this.peek().type !== 'rparen') {
      throw new BadRequestException('Expected a closing ")" after the IN value list');
    }
    this.pos++;
    return {
      type: 'comparison',
      field,
      operator: negatedIn ? 'not in' : 'in',
      value: { kind: 'list', values },
    };
  }

  private parseValue(): JqlScalarValue {
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

const ARRAY_FIELDS: ReadonlySet<JqlField> = new Set([
  'labels',
  'components',
  'fixVersions',
  'affectsVersions',
]);
const OBJECT_ID_FIELDS: ReadonlySet<JqlField> = new Set([
  'project',
  'assignee',
  'createdBy',
  'sprint',
  'parent',
  'fixVersions',
  'affectsVersions',
]);
const NUMERIC_FIELDS: ReadonlySet<JqlField> = new Set(['storyPoints']);
const CURRENT_USER_FIELDS: ReadonlySet<JqlField> = new Set(['assignee', 'createdBy']);

function resolveValue(
  field: JqlField,
  value: JqlScalarValue,
  actingUser: AuthenticatedUser,
): string {
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

  if (field === 'text' && operator !== '~') {
    throw new BadRequestException('"text" only supports the "~" (contains) operator');
  }
  if (field !== 'text' && operator === '~') {
    throw new BadRequestException('"~" is only supported on the "text" field');
  }

  // IN / NOT IN - handled once, generically, for every field: resolve each list element the same
  // way a scalar comparison would, then $in/$nin. Narrowing on operator here is also what proves
  // to the compiler that `node.value` can no longer be the `list` variant below.
  if (operator === 'in' || operator === 'not in') {
    if (node.value.kind !== 'list') {
      throw new BadRequestException('IN/NOT IN requires a value list');
    }
    const rawValues = node.value.values.map((v) => resolveValue(field, v, actingUser));
    const resolvedValues: Array<string | Types.ObjectId> = OBJECT_ID_FIELDS.has(field)
      ? rawValues.map((v) => new Types.ObjectId(v))
      : rawValues;
    return operator === 'in'
      ? { [field]: { $in: resolvedValues } }
      : { [field]: { $nin: resolvedValues } };
  }

  // Every branch below is for a scalar (non-list) comparison - the parser only ever produces a
  // `list` value alongside 'in'/'not in' (handled and returned above), so this is unreachable in
  // practice; it exists to prove that to the type-checker, which can't correlate `operator` and
  // `value`'s types across two separate properties on its own.
  if (node.value.kind === 'list') {
    throw new BadRequestException(`"${operator}" does not take a value list`);
  }
  const value = node.value;

  if (field === 'text') {
    const pattern = escapeRegex(resolveValue(field, value, actingUser));
    return {
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { description: { $regex: pattern, $options: 'i' } },
        { issueKey: { $regex: pattern, $options: 'i' } },
      ],
    };
  }

  if (field === 'dueDate') {
    const raw = resolveValue(field, value, actingUser);
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

  if (NUMERIC_FIELDS.has(field)) {
    const raw = resolveValue(field, value, actingUser);
    const num = Number(raw);
    if (Number.isNaN(num)) {
      throw new BadRequestException(`"${raw}" is not a valid number for "${field}"`);
    }
    switch (operator) {
      case '=':
        return { [field]: num };
      case '!=':
        return { [field]: { $ne: num } };
      case '>':
        return { [field]: { $gt: num } };
      case '>=':
        return { [field]: { $gte: num } };
      case '<':
        return { [field]: { $lt: num } };
      case '<=':
        return { [field]: { $lte: num } };
    }
  }

  if (operator === '>' || operator === '>=' || operator === '<' || operator === '<=') {
    throw new BadRequestException(
      `"${operator}" is only supported on the "dueDate" and "storyPoints" fields`,
    );
  }

  const raw = resolveValue(field, value, actingUser);
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
 * Defense-in-depth re-check that every `orderBy[].field` is one of the allowed sort fields - the
 * parser already canonicalizes and validates this at parse time (see `Parser.parse()`), so this
 * only ever throws for an `orderBy` built some other way than `parseJql()`.
 */
export function assertValidJqlOrderBy(orderBy: JqlOrderBy[] | undefined): void {
  if (!orderBy) return;
  for (const term of orderBy) {
    if (!(JQL_SORT_FIELDS as readonly string[]).includes(term.field)) {
      throw new BadRequestException(
        `Cannot ORDER BY "${term.field}" - expected one of: ${JQL_SORT_FIELDS.join(', ')}`,
      );
    }
  }
}

/**
 * Compiles a parsed multi-key ORDER BY into a Mongo sort object - array order becomes tie-break
 * precedence (Mongo sort objects are themselves key-ordered). Defaults to the pre-JQL behavior
 * (newest first) when the query has no ORDER BY clause at all, and - matching
 * `buildTaskListSort`'s own existing convention - appends `createdAt` ascending as a final
 * tie-break for pagination stability whenever the caller's own ORDER BY didn't already sort by it.
 */
export function buildJqlSort(orderBy: JqlOrderBy[] | undefined): Record<string, 1 | -1> {
  if (!orderBy || orderBy.length === 0) return { createdAt: -1 };
  const sort: Record<string, 1 | -1> = {};
  for (const term of orderBy) {
    sort[term.field] = term.direction === 'asc' ? 1 : -1;
  }
  if (!('createdAt' in sort)) sort.createdAt = 1;
  return sort;
}
