import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { ListProjectsDto } from '../projects/dto/list-projects.dto';
import { ListUsersDto } from '../users/dto/list-users.dto';

export interface GlobalSearchTaskResult {
  id: string;
  issueKey: string | null;
  title: string;
  project: { id: string; name: string } | null;
  status: string;
  statusCategory: string;
}

export interface GlobalSearchProjectResult {
  id: string;
  name: string;
  status: string;
}

export interface GlobalSearchUserResult {
  id: string;
  name: string;
  email: string;
}

export interface GlobalSearchResult {
  tasks: GlobalSearchTaskResult[];
  projects: GlobalSearchProjectResult[];
  users: GlobalSearchUserResult[];
}

/**
 * Module 11's "search everything" bar. Deliberately a thin composer over three ALREADY-SECURITY-
 * SCOPED existing services rather than new query logic of its own - `TasksService.search()` (its
 * accessible-project + security-level exclusion filtering, Modules 4/6), `ProjectsService.paginate()`
 * (its owner/member visibility scoping), and `UsersService.paginate()` (org-scoped) each already
 * enforce exactly the access rules a global search must not bypass. Duplicating that logic here
 * instead of reusing it would risk the two copies drifting apart - the one thing this must never do.
 *
 * Comments are deliberately out of scope for v1: `Comment` has no `organizationId` of its own (only
 * a `task` ref), so scoping a comment search to the caller's org/accessible-projects would need a
 * new join this codebase's search patterns don't otherwise need - a real gap, not an oversight, and
 * worth revisiting only if a future module needs it.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
  ) {}

  async searchAll(
    term: string,
    limit: number,
    actingUser: AuthenticatedUser,
  ): Promise<GlobalSearchResult> {
    // Mirrors CommandPalette's own JQL-string-building convention (Module 10) - strip quotes
    // rather than fully escape, since a `text ~ '...'` value is never used as anything but a
    // literal regex source server-side.
    const escapedTerm = term.replace(/'/g, '');

    const [taskResult, projectResult, userResult] = await Promise.all([
      this.tasksService.search(
        { jql: `text ~ '${escapedTerm}'`, page: 1, limit, sortOrder: 'desc' },
        actingUser,
      ),
      this.projectsService.paginate(
        { page: 1, limit, search: term, sortBy: 'name', sortOrder: 'asc' } as ListProjectsDto,
        actingUser,
      ),
      this.usersService.paginate(
        {
          page: 1,
          limit,
          search: term,
          isActive: 'true',
          sortBy: 'name',
          sortOrder: 'asc',
        } as ListUsersDto,
        requireOrgId(actingUser),
      ),
    ]);

    return {
      // `task.project` is populated to `{id, name}` by `tasksRepository.paginateWithFilter` -
      // the schema's static type (`Types.ObjectId`) doesn't see that, the same documented
      // populate-vs-schema-type mismatch every other populated-field read in this codebase casts
      // through.
      tasks: taskResult.data.map((task) => {
        const project = task.project as unknown as { id: string; name: string } | null;
        return {
          id: task.id,
          issueKey: task.issueKey,
          title: task.title,
          project: project ? { id: project.id, name: project.name } : null,
          status: task.status,
          statusCategory: task.statusCategory,
        };
      }),
      projects: projectResult.data.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
      })),
      users: userResult.data.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      })),
    };
  }
}
