import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { assertValidJqlOrderBy, compileJqlAst, parseJql } from 'src/modules/tasks/search/jql.util';
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
    expect(orderBy).toEqual({ field: 'priority', direction: 'desc' });
  });

  it('defaults ORDER BY direction to ascending when omitted', () => {
    const { orderBy } = parseJql('status = Done ORDER BY dueDate');
    expect(orderBy).toEqual({ field: 'dueDate', direction: 'asc' });
  });

  it('rejects an unsupported ORDER BY field', () => {
    expect(() => parseJql('status = Done ORDER BY text')).toThrow(BadRequestException);
  });

  it('omits orderBy when there is no ORDER BY clause', () => {
    const { orderBy } = parseJql('status = Done');
    expect(orderBy).toBeUndefined();
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
});

describe('assertValidJqlOrderBy', () => {
  it('accepts an allowed sort field', () => {
    expect(() => assertValidJqlOrderBy({ field: 'priority', direction: 'asc' })).not.toThrow();
  });

  it('is a no-op when orderBy is undefined', () => {
    expect(() => assertValidJqlOrderBy(undefined)).not.toThrow();
  });

  it('rejects an unsupported sort field', () => {
    expect(() => assertValidJqlOrderBy({ field: 'text', direction: 'asc' })).toThrow(
      BadRequestException,
    );
  });
});
