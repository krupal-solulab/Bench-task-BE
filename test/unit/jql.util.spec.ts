import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  analyzeCurrentSprintUsage,
  assertValidJqlOrderBy,
  buildJqlSort,
  compileJqlAst,
  parseJql,
  substituteCurrentSprint,
} from 'src/modules/tasks/search/jql.util';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { Role } from 'src/common/enums/role.enum';

const USER_ID = new Types.ObjectId().toString();
const OTHER_ID = new Types.ObjectId().toString();
const PROJECT_ID = new Types.ObjectId().toString();

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ID,
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('parseJql', () => {
  it('rejects an empty query', () => {
    expect(() => parseJql('')).toThrow(BadRequestException);
    expect(() => parseJql('   ')).toThrow(BadRequestException);
  });

  it('rejects an unknown field', () => {
    expect(() => parseJql('bogus = "x"')).toThrow(BadRequestException);
  });

  it('rejects a comparison missing an operator', () => {
    expect(() => parseJql('status "Done"')).toThrow(BadRequestException);
  });

  it('rejects an unterminated string', () => {
    expect(() => parseJql('status = "Done')).toThrow(BadRequestException);
  });

  it('rejects an unclosed parenthesis', () => {
    expect(() => parseJql('(status = Done')).toThrow(BadRequestException);
  });

  it('rejects trailing garbage after a valid query', () => {
    expect(() => parseJql('status = Done extra')).toThrow(BadRequestException);
  });

  it('parses a single comparison', () => {
    const { ast } = parseJql('status = Done');
    expect(ast).toEqual({
      type: 'comparison',
      field: 'status',
      operator: '=',
      value: { kind: 'literal', value: 'Done' },
    });
  });

  it('is case-insensitive for field names and keywords, case-sensitive for values', () => {
    const { ast } = parseJql('STATUS = Done aNd Priority = P1');
    expect(ast).toEqual({
      type: 'and',
      left: {
        type: 'comparison',
        field: 'status',
        operator: '=',
        value: { kind: 'literal', value: 'Done' },
      },
      right: {
        type: 'comparison',
        field: 'priority',
        operator: '=',
        value: { kind: 'literal', value: 'P1' },
      },
    });
  });

  it('AND binds tighter than OR', () => {
    const { ast } = parseJql('status = Done OR status = Todo AND priority = P1');
    expect(ast).toEqual({
      type: 'or',
      left: {
        type: 'comparison',
        field: 'status',
        operator: '=',
        value: { kind: 'literal', value: 'Done' },
      },
      right: {
        type: 'and',
        left: {
          type: 'comparison',
          field: 'status',
          operator: '=',
          value: { kind: 'literal', value: 'Todo' },
        },
        right: {
          type: 'comparison',
          field: 'priority',
          operator: '=',
          value: { kind: 'literal', value: 'P1' },
        },
      },
    });
  });

  it('parentheses override default precedence', () => {
    const { ast } = parseJql('(status = Done OR status = Todo) AND priority = P1');
    expect(ast.type).toBe('and');
    expect((ast as { left: { type: string } }).left.type).toBe('or');
  });

  it('parses a NOT prefix on a group', () => {
    const { ast } = parseJql('NOT (status = Done)');
    expect(ast.type).toBe('not');
  });

  it('parses a quoted multi-word value', () => {
    const { ast } = parseJql('status = "In Progress"');
    expect(ast).toEqual({
      type: 'comparison',
      field: 'status',
      operator: '=',
      value: { kind: 'literal', value: 'In Progress' },
    });
  });

  it('parses currentUser() as a value', () => {
    const { ast } = parseJql('assignee = currentUser()');
    expect(ast).toEqual({
      type: 'comparison',
      field: 'assignee',
      operator: '=',
      value: { kind: 'currentUser' },
    });
  });

  it('parses an optional trailing ORDER BY with direction', () => {
    const { orderBy } = parseJql('status = Done ORDER BY priority DESC');
    expect(orderBy).toEqual([{ field: 'priority', direction: 'desc' }]);
  });

  it('defaults ORDER BY direction to ascending when omitted', () => {
    const { orderBy } = parseJql('status = Done ORDER BY dueDate');
    expect(orderBy).toEqual([{ field: 'dueDate', direction: 'asc' }]);
  });

  it('rejects an unsupported ORDER BY field', () => {
    expect(() => parseJql('status = Done ORDER BY text')).toThrow(BadRequestException);
  });

  it('omits orderBy when there is no ORDER BY clause', () => {
    const { orderBy } = parseJql('status = Done');
    expect(orderBy).toBeUndefined();
  });

  it('parses multiple comma-separated ORDER BY terms (Module 4)', () => {
    const { orderBy } = parseJql('status = Done ORDER BY priority DESC, dueDate ASC');
    expect(orderBy).toEqual([
      { field: 'priority', direction: 'desc' },
      { field: 'dueDate', direction: 'asc' },
    ]);
  });

  it('rejects a second ORDER BY term with an unsupported field', () => {
    expect(() => parseJql('status = Done ORDER BY priority, text')).toThrow(BadRequestException);
  });

  it('parses "field IN (...)" as an in comparison over a value list (Module 4)', () => {
    const { ast } = parseJql('priority IN (P1, P2)');
    expect(ast).toEqual({
      type: 'comparison',
      field: 'priority',
      operator: 'in',
      value: {
        kind: 'list',
        values: [
          { kind: 'literal', value: 'P1' },
          { kind: 'literal', value: 'P2' },
        ],
      },
    });
  });

  it('parses "field NOT IN (...)" as a not-in comparison', () => {
    const { ast } = parseJql('status NOT IN ("Done", "Closed")');
    expect(ast).toEqual({
      type: 'comparison',
      field: 'status',
      operator: 'not in',
      value: {
        kind: 'list',
        values: [
          { kind: 'literal', value: 'Done' },
          { kind: 'literal', value: 'Closed' },
        ],
      },
    });
  });

  it('rejects IN without a value list', () => {
    expect(() => parseJql('priority IN P1')).toThrow(BadRequestException);
  });

  it('rejects an unterminated IN value list', () => {
    expect(() => parseJql('priority IN (P1, P2')).toThrow(BadRequestException);
  });
});

describe('compileJqlAst', () => {
  const user = makeUser();

  it('compiles a scalar equality', () => {
    const { ast } = parseJql('status = Done');
    expect(compileJqlAst(ast, user)).toEqual({ status: 'Done' });
  });

  it('compiles a scalar inequality', () => {
    const { ast } = parseJql('status != Done');
    expect(compileJqlAst(ast, user)).toEqual({ status: { $ne: 'Done' } });
  });

  it('compiles an AND of two comparisons', () => {
    const { ast } = parseJql('status = Done AND priority = P1');
    expect(compileJqlAst(ast, user)).toEqual({
      $and: [{ status: 'Done' }, { priority: 'P1' }],
    });
  });

  it('compiles an OR of two comparisons', () => {
    const { ast } = parseJql('status = Done OR status = Todo');
    expect(compileJqlAst(ast, user)).toEqual({
      $or: [{ status: 'Done' }, { status: 'Todo' }],
    });
  });

  it('compiles NOT to $nor', () => {
    const { ast } = parseJql('NOT (status = Done)');
    expect(compileJqlAst(ast, user)).toEqual({ $nor: [{ status: 'Done' }] });
  });

  it('compiles an ObjectId field to a real ObjectId', () => {
    const { ast } = parseJql(`project = "${PROJECT_ID}"`);
    const compiled = compileJqlAst(ast, user) as { project: Types.ObjectId };
    expect(compiled.project).toBeInstanceOf(Types.ObjectId);
    expect(compiled.project.toString()).toBe(PROJECT_ID);
  });

  it('resolves currentUser() for assignee to the acting user id', () => {
    const { ast } = parseJql('assignee = currentUser()');
    const compiled = compileJqlAst(ast, user) as { assignee: Types.ObjectId };
    expect(compiled.assignee.toString()).toBe(user.id);
  });

  it('resolves currentUser() for createdBy the same way', () => {
    const { ast } = parseJql('createdBy = currentUser()');
    const compiled = compileJqlAst(ast, makeUser({ id: OTHER_ID })) as {
      createdBy: Types.ObjectId;
    };
    expect(compiled.createdBy.toString()).toBe(OTHER_ID);
  });

  it('rejects currentUser() on a field other than assignee/createdBy', () => {
    const { ast } = parseJql('project = currentUser()');
    expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
  });

  it('compiles "sprint" to a real ObjectId once substituted', () => {
    const SPRINT_ID = new Types.ObjectId().toString();
    const { ast } = parseJql(`sprint = "${SPRINT_ID}"`);
    const compiled = compileJqlAst(ast, user) as { sprint: Types.ObjectId };
    expect(compiled.sprint.toString()).toBe(SPRINT_ID);
  });

  it('rejects an un-substituted "sprint = current" reaching the compiler', () => {
    const { ast } = parseJql('sprint = current');
    expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
  });

  it('compiles a "contains" clause on an array field (labels)', () => {
    const { ast } = parseJql('labels = urgent');
    expect(compileJqlAst(ast, user)).toEqual({ labels: 'urgent' });
  });

  it('compiles a "does not contain" clause on an array field (components)', () => {
    const { ast } = parseJql('components != API');
    expect(compileJqlAst(ast, user)).toEqual({ components: { $ne: 'API' } });
  });

  describe('text field', () => {
    it('compiles ~ to the same contains-regex shape as the existing search filter', () => {
      const { ast } = parseJql('text ~ hero');
      expect(compileJqlAst(ast, user)).toEqual({
        $or: [
          { title: { $regex: 'hero', $options: 'i' } },
          { description: { $regex: 'hero', $options: 'i' } },
          { issueKey: { $regex: 'hero', $options: 'i' } },
        ],
      });
    });

    it('escapes regex metacharacters in the search term', () => {
      const { ast } = parseJql('text ~ "a.b*c"');
      const compiled = compileJqlAst(ast, user) as { $or: Array<{ title: { $regex: string } }> };
      expect(compiled.$or[0]!.title.$regex).toBe('a\\.b\\*c');
    });

    it('rejects "=" on the text field', () => {
      const { ast } = parseJql('text = hero');
      expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
    });

    it('rejects "~" on a field other than text', () => {
      const { ast } = parseJql('status ~ Done');
      expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
    });
  });

  describe('dueDate comparisons', () => {
    it.each([
      ['=', 'dueDate'],
      ['!=', '$ne'],
      ['>', '$gt'],
      ['>=', '$gte'],
      ['<', '$lt'],
      ['<=', '$lte'],
    ])('compiles "%s"', (operator) => {
      const { ast } = parseJql(`dueDate ${operator} 2026-01-01`);
      const compiled = compileJqlAst(ast, user) as Record<string, unknown>;
      expect(compiled.dueDate).toBeDefined();
    });

    it('rejects an invalid date value', () => {
      const { ast } = parseJql('dueDate = not-a-date');
      expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
    });

    it('rejects a comparison operator on a non-dueDate field', () => {
      const { ast } = parseJql('priority > P1');
      expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
    });
  });

  describe('storyPoints comparisons (Module 4)', () => {
    it.each([
      ['=', 'storyPoints'],
      ['!=', '$ne'],
      ['>', '$gt'],
      ['>=', '$gte'],
      ['<', '$lt'],
      ['<=', '$lte'],
    ])('compiles "%s"', (operator) => {
      const { ast } = parseJql(`storyPoints ${operator} 5`);
      const compiled = compileJqlAst(ast, user) as Record<string, unknown>;
      expect(compiled.storyPoints).toBeDefined();
    });

    it('rejects a non-numeric value', () => {
      const { ast } = parseJql('storyPoints = abc');
      expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
    });
  });

  describe('IN / NOT IN (Module 4)', () => {
    it('compiles "field IN (...)" to $in', () => {
      const { ast } = parseJql('priority IN (P1, P2)');
      expect(compileJqlAst(ast, user)).toEqual({ priority: { $in: ['P1', 'P2'] } });
    });

    it('compiles "field NOT IN (...)" to $nin', () => {
      const { ast } = parseJql('status NOT IN ("Done", "Closed")');
      expect(compileJqlAst(ast, user)).toEqual({ status: { $nin: ['Done', 'Closed'] } });
    });

    it('resolves each element of an ObjectId field IN-list to a real ObjectId', () => {
      const { ast } = parseJql(`project IN (${PROJECT_ID})`);
      const compiled = compileJqlAst(ast, user) as { project: { $in: Types.ObjectId[] } };
      expect(compiled.project.$in[0]).toBeInstanceOf(Types.ObjectId);
      expect(compiled.project.$in[0]!.toString()).toBe(PROJECT_ID);
    });

    it('resolves currentUser() inside an IN list', () => {
      const { ast } = parseJql('assignee IN (currentUser())');
      const compiled = compileJqlAst(ast, user) as { assignee: { $in: Types.ObjectId[] } };
      expect(compiled.assignee.$in[0]!.toString()).toBe(USER_ID);
    });

    it('rejects IN on the text field', () => {
      const { ast } = parseJql('text IN (foo, bar)');
      expect(() => compileJqlAst(ast, user)).toThrow(BadRequestException);
    });
  });
});

describe('assertValidJqlOrderBy', () => {
  it('accepts an allowed sort field', () => {
    expect(() => assertValidJqlOrderBy([{ field: 'priority', direction: 'asc' }])).not.toThrow();
  });

  it('is a no-op when orderBy is undefined', () => {
    expect(() => assertValidJqlOrderBy(undefined)).not.toThrow();
  });

  it('rejects an unsupported sort field', () => {
    expect(() => assertValidJqlOrderBy([{ field: 'text', direction: 'asc' }])).toThrow(
      BadRequestException,
    );
  });

  it('rejects when any term in a multi-term list is unsupported', () => {
    expect(() =>
      assertValidJqlOrderBy([
        { field: 'priority', direction: 'asc' },
        { field: 'text', direction: 'asc' },
      ]),
    ).toThrow(BadRequestException);
  });
});

describe('buildJqlSort', () => {
  it('defaults to newest-first when there is no ORDER BY', () => {
    expect(buildJqlSort(undefined)).toEqual({ createdAt: -1 });
    expect(buildJqlSort([])).toEqual({ createdAt: -1 });
  });

  it('builds a single-key sort object, appending createdAt as a stability tie-break', () => {
    expect(buildJqlSort([{ field: 'priority', direction: 'desc' }])).toEqual({
      priority: -1,
      createdAt: 1,
    });
  });

  it('builds a multi-key sort object preserving order as tie-break precedence', () => {
    expect(
      buildJqlSort([
        { field: 'priority', direction: 'desc' },
        { field: 'dueDate', direction: 'asc' },
      ]),
    ).toEqual({ priority: -1, dueDate: 1, createdAt: 1 });
  });

  it('does not append a redundant createdAt tie-break when the caller already sorts by it', () => {
    expect(buildJqlSort([{ field: 'createdAt', direction: 'desc' }])).toEqual({ createdAt: -1 });
  });
});

describe('analyzeCurrentSprintUsage', () => {
  it('detects "sprint = current" and the single project it is scoped to', () => {
    const { ast } = parseJql(`project = "${PROJECT_ID}" AND sprint = current`);
    expect(analyzeCurrentSprintUsage(ast)).toEqual({
      usesCurrentSprint: true,
      projectIds: [PROJECT_ID],
    });
  });

  it('reports no current-sprint usage for an ordinary query', () => {
    const { ast } = parseJql('status = Done');
    expect(analyzeCurrentSprintUsage(ast)).toEqual({ usesCurrentSprint: false, projectIds: [] });
  });

  it('collects every distinct project referenced, even without "sprint = current"', () => {
    const OTHER_PROJECT_ID = new Types.ObjectId().toString();
    const { ast } = parseJql(`project = "${PROJECT_ID}" OR project = "${OTHER_PROJECT_ID}"`);
    const result = analyzeCurrentSprintUsage(ast);
    expect(result.usesCurrentSprint).toBe(false);
    expect(result.projectIds.sort()).toEqual([PROJECT_ID, OTHER_PROJECT_ID].sort());
  });
});

describe('substituteCurrentSprint', () => {
  it('replaces "current" with the given sprint id, leaving other comparisons untouched', () => {
    const SPRINT_ID = new Types.ObjectId().toString();
    const { ast } = parseJql(`project = "${PROJECT_ID}" AND sprint = current`);
    const substituted = substituteCurrentSprint(ast, SPRINT_ID);
    const compiled = compileJqlAst(substituted, makeUser()) as {
      $and: [{ project: Types.ObjectId }, { sprint: Types.ObjectId }];
    };
    expect(compiled.$and[0].project.toString()).toBe(PROJECT_ID);
    expect(compiled.$and[1].sprint.toString()).toBe(SPRINT_ID);
  });
});
