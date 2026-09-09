import { PinoLogger } from 'nestjs-pino';
import { JwtService } from '@nestjs/jwt';
import { Server } from 'socket.io';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedSocket, EventsGateway } from 'src/events/events.gateway';
import { UsersService } from 'src/modules/users/users.service';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';
import { ProjectsService } from 'src/modules/projects/projects.service';

function makeLogger(): PinoLogger {
  return { debug: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;
}

function makeSocket(token?: string): AuthenticatedSocket {
  return {
    handshake: { auth: token !== undefined ? { token } : {} },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  } as unknown as AuthenticatedSocket;
}

/** Captures the single middleware function EventsGateway registers via `server.use(...)`. */
function captureMiddleware(gateway: EventsGateway) {
  const use = jest.fn();
  const fakeServer = { use } as unknown as Server;
  gateway.afterInit(fakeServer);
  expect(use).toHaveBeenCalledTimes(1);
  return use.mock.calls[0][0] as (client: AuthenticatedSocket, next: (err?: Error) => void) => void;
}

describe('EventsGateway', () => {
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'findByIdOrThrow'>>;
  let organizationsService: jest.Mocked<Pick<OrganizationsService, 'assertActive'>>;
  let projectsService: jest.Mocked<
    Pick<ProjectsService, 'getActiveProjectOrThrow' | 'assertUserCanView'>
  >;
  let gateway: EventsGateway;

  const payload = {
    sub: 'user-1',
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: 'org-1',
  };

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    usersService = { findByIdOrThrow: jest.fn() };
    organizationsService = { assertActive: jest.fn().mockResolvedValue(undefined) };
    projectsService = {
      getActiveProjectOrThrow: jest.fn(),
      assertUserCanView: jest.fn(),
    };
    gateway = new EventsGateway(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
      organizationsService as unknown as OrganizationsService,
      projectsService as unknown as ProjectsService,
      makeLogger(),
    );
  });

  describe('handshake middleware (registered in afterInit)', () => {
    it('authenticates a valid token, attaches the user, and calls next() with no error', async () => {
      const middleware = captureMiddleware(gateway);
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue(payload);
      usersService.findByIdOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        isActive: true,
        organizationId: { toString: () => 'org-1' },
      } as never);

      const next = jest.fn();
      middleware(client, next);
      await new Promise((r) => setImmediate(r));

      expect(client.data.user).toEqual({
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        organizationId: 'org-1',
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects a client that presents no token', async () => {
      const middleware = captureMiddleware(gateway);
      const client = makeSocket(undefined);

      const next = jest.fn();
      middleware(client, next);
      await new Promise((r) => setImmediate(r));

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('rejects a client whose token fails signature verification', async () => {
      const middleware = captureMiddleware(gateway);
      const client = makeSocket('bad-token');
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      const next = jest.fn();
      middleware(client, next);
      await new Promise((r) => setImmediate(r));

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects a client whose user no longer exists', async () => {
      const middleware = captureMiddleware(gateway);
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue(payload);
      usersService.findByIdOrThrow.mockRejectedValue(new Error('not found'));

      const next = jest.fn();
      middleware(client, next);
      await new Promise((r) => setImmediate(r));

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects a client whose user has been deactivated', async () => {
      const middleware = captureMiddleware(gateway);
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue(payload);
      usersService.findByIdOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        isActive: false,
        organizationId: { toString: () => 'org-1' },
      } as never);

      const next = jest.fn();
      middleware(client, next);
      await new Promise((r) => setImmediate(r));

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects a client whose organization has been suspended', async () => {
      const middleware = captureMiddleware(gateway);
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue(payload);
      usersService.findByIdOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        isActive: true,
        organizationId: { toString: () => 'org-1' },
      } as never);
      organizationsService.assertActive.mockRejectedValue(new Error('suspended'));

      const next = jest.fn();
      middleware(client, next);
      await new Promise((r) => setImmediate(r));

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('handleConnection', () => {
    it('joins the org room for an authenticated user (auth already done by the middleware)', () => {
      const client = makeSocket('valid-token');
      client.data.user = {
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        organizationId: 'org-1',
      };

      gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('org:org-1');
    });

    it('joins no org room for a PlatformAdmin (null organizationId)', () => {
      const client = makeSocket('valid-token');
      client.data.user = {
        id: 'platform-1',
        email: 'p@a.com',
        role: Role.PLATFORM_ADMIN,
        organizationId: null,
      };

      gateway.handleConnection(client);

      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinProject', () => {
    it('joins the project room when the user can view the project', async () => {
      const client = makeSocket('valid-token');
      client.data.user = {
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        organizationId: 'org-1',
      };
      const project = { id: 'project-1' };
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project as never);
      projectsService.assertUserCanView.mockReturnValue(undefined);

      await gateway.handleJoinProject(client, 'project-1');

      expect(client.join).toHaveBeenCalledWith('project:project-1');
    });

    it('does not join the room when the user cannot view the project', async () => {
      const client = makeSocket('valid-token');
      client.data.user = {
        id: 'user-1',
        email: 'a@a.com',
        role: Role.DEVELOPER,
        organizationId: 'org-1',
      };
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.assertUserCanView.mockImplementation(() => {
        throw new Error('forbidden');
      });

      await gateway.handleJoinProject(client, 'project-1');

      expect(client.join).not.toHaveBeenCalled();
    });

    it('ignores the request from an unauthenticated socket', async () => {
      const client = makeSocket('valid-token');

      await gateway.handleJoinProject(client, 'project-1');

      expect(projectsService.getActiveProjectOrThrow).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleLeaveProject', () => {
    it('leaves the given project room', () => {
      const client = makeSocket('valid-token');

      gateway.handleLeaveProject(client, 'project-1');

      expect(client.leave).toHaveBeenCalledWith('project:project-1');
    });
  });
});
