import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser, JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { UsersService } from '../modules/users/users.service';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { ProjectsService } from '../modules/projects/projects.service';
import { CommentCreatedEvent, TaskStatusChangedEvent } from './events.types';

export interface AuthenticatedSocket extends Socket {
  data: { user?: AuthenticatedUser };
}

// Matches the existing deliberately-wide-open HTTP CORS policy (see main.ts) - auth here is the
// bearer token in the handshake, not a cookie, so there's no session to leak by allowing any
// origin. CORS_ORIGIN / main.ts's `origin: '*'` is untouched by this file.
@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly projectsService: ProjectsService,
    @InjectPinoLogger(EventsGateway.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Registered as Socket.IO middleware (runs during the handshake, before the client ever sees
   * "connect") rather than in handleConnection - a client that emits `join:project` the instant
   * it sees "connect" would otherwise race an async handleConnection auth check that hasn't
   * finished attaching the user to the socket yet. Middleware auth fully resolves first, so by
   * the time the client is connected at all, `client.data.user` is guaranteed to be set.
   */
  afterInit(server: Server): void {
    server.use((client, next) => {
      this.authenticate(client)
        .then(() => next())
        .catch((err: unknown) => {
          this.logger.debug({ err }, 'rejecting websocket connection: invalid or expired session');
          next(new Error('Unauthorized'));
        });
    });
  }

  /**
   * Passport's JwtStrategy only runs against HTTP requests - a socket handshake gets no
   * automatic auth, so this manually replicates JwtStrategy.validate()'s exact checks (valid
   * signature, user still active, organization not suspended).
   */
  private async authenticate(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) throw new Error('missing token');

    const payload = this.jwtService.verify<JwtPayload>(token);
    const user = await this.usersService.findByIdOrThrow(payload.sub).catch(() => null);
    if (!user || !user.isActive) throw new Error('invalid or expired session');

    const organizationId = user.organizationId ? user.organizationId.toString() : null;
    await this.organizationsService.assertActive(organizationId);

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId,
    };
    (client as AuthenticatedSocket).data.user = authenticatedUser;
  }

  /** Only ever called for sockets that already passed the middleware auth check above. */
  handleConnection(client: AuthenticatedSocket): void {
    // PlatformAdmin connections (organizationId: null) join no org room and never receive
    // org-scoped events, consistent with them never seeing org data over HTTP either.
    const organizationId = client.data.user?.organizationId;
    if (organizationId) {
      void client.join(`org:${organizationId}`);
    }
  }

  @SubscribeMessage('join:project')
  async handleJoinProject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() projectId: unknown,
  ): Promise<void> {
    const user = client.data.user;
    if (!user || typeof projectId !== 'string') return;
    try {
      const project = await this.projectsService.getActiveProjectOrThrow(projectId);
      this.projectsService.assertUserCanView(project, user);
      await client.join(`project:${projectId}`);
    } catch (err) {
      this.logger.debug({ err, projectId }, 'rejected join:project request');
    }
  }

  @SubscribeMessage('leave:project')
  handleLeaveProject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() projectId: unknown,
  ): void {
    if (typeof projectId !== 'string') return;
    void client.leave(`project:${projectId}`);
  }

  emitTaskStatusChanged(event: TaskStatusChangedEvent): void {
    this.server.to(`project:${event.projectId}`).emit('task:statusChanged', event);
  }

  emitCommentCreated(event: CommentCreatedEvent): void {
    this.server.to(`project:${event.projectId}`).emit('comment:created', event);
  }
}
