import { createHash, randomBytes, randomInt } from 'crypto';
import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { AppConfig } from '../../config/configuration';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { extractId } from '../../common/utils/mongo.util';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProjectsService } from '../projects/projects.service';
import { ProjectDocument } from '../projects/schemas/project.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { CreateProjectInviteDto } from './dto/create-project-invite.dto';
import {
  ProjectInvite,
  ProjectInviteDocument,
  ProjectInviteStatus,
} from './schemas/project-invite.schema';

export const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** No look-alikes (0/O, 1/l/I) - the password may be read out or retyped from an email. */
const TEMP_PASSWORD_LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const TEMP_PASSWORD_DIGITS = '23456789';
const TEMP_PASSWORD_LENGTH = 12;

export type ProjectInviteViewStatus = `${ProjectInviteStatus}` | 'Expired';

export interface ProjectInviteView {
  id: string;
  projectId: string;
  email: string;
  name: string | null;
  role: string;
  status: ProjectInviteViewStatus;
  expiresAt: Date;
  invitedBy: { id: string; name: string } | null;
  resendCount: number;
  lastSentAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Returned only when an invite is sent or resent - the one time the secrets leave the server. */
export interface SentProjectInvite {
  invite: ProjectInviteView;
  inviteUrl: string;
  temporaryPassword: string;
  emailSent: boolean;
}

/** What the public invitation page shows before the invitee signs in. */
export interface ProjectInvitePreview {
  status: ProjectInviteViewStatus;
  email: string;
  role: string;
  projectName: string;
  organizationName: string | null;
  inviterName: string | null;
  expiresAt: Date;
}

const MESSAGES = {
  revoked: 'This invitation has been revoked. Ask the project owner for a new one.',
  expired: 'This invitation has expired. Ask the project owner to resend it.',
  accepted: 'This invitation has already been accepted. Sign in with your email and password.',
  projectGone: 'The project for this invitation no longer exists.',
  wrongPassword: 'Incorrect temporary password',
};

@Injectable()
export class ProjectInvitesService {
  constructor(
    @InjectModel(ProjectInvite.name) private readonly model: Model<ProjectInviteDocument>,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async create(
    projectId: string,
    dto: CreateProjectInviteDto,
    actingUser: AuthenticatedUser,
  ): Promise<SentProjectInvite> {
    const project = await this.projectsService.getManageableProject(projectId, actingUser);
    const email = dto.email.trim().toLowerCase();
    await this.assertEmailInvitable(email, projectId);

    const token = randomBytes(32).toString('base64url');
    const temporaryPassword = generateTemporaryPassword();
    const created = await this.model.create({
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
      project: project._id,
      email,
      role: dto.role,
      tokenHash: hashToken(token),
      tempPasswordHash: await this.usersService.hashPassword(temporaryPassword),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: new Types.ObjectId(actingUser.id),
      lastSentAt: new Date(),
    });

    const sent = await this.deliver(created, project, token, temporaryPassword, actingUser);
    await this.audit(actingUser, AuditAction.PROJECT_INVITE_SENT, created, project);
    return sent;
  }

  async list(projectId: string, actingUser: AuthenticatedUser): Promise<ProjectInviteView[]> {
    await this.projectsService.getManageableProject(projectId, actingUser, false);
    const invites = await this.model
      .find({ project: new Types.ObjectId(projectId) })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('invitedBy', 'name')
      .exec();
    return invites.map((i) => toView(i));
  }

  /** A fresh link and temporary password (the old ones stop working) and a new 7-day window. */
  async resend(
    projectId: string,
    inviteId: string,
    actingUser: AuthenticatedUser,
  ): Promise<SentProjectInvite> {
    const project = await this.projectsService.getManageableProject(projectId, actingUser);
    const invite = await this.findInProjectOrThrow(projectId, inviteId);
    if (invite.status === ProjectInviteStatus.ACCEPTED) {
      throw new ConflictException('This invitation has already been accepted');
    }
    if (invite.status === ProjectInviteStatus.REVOKED) {
      throw new ConflictException('This invitation was revoked - send a new invitation instead');
    }
    if (await this.usersService.isEmailRegistered(invite.email)) {
      throw new ConflictException(
        'A user with this email already exists - add them as an existing member instead',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const temporaryPassword = generateTemporaryPassword();
    invite.tokenHash = hashToken(token);
    invite.tempPasswordHash = await this.usersService.hashPassword(temporaryPassword);
    invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    invite.resendCount += 1;
    invite.lastSentAt = new Date();
    await invite.save();

    const sent = await this.deliver(invite, project, token, temporaryPassword, actingUser);
    await this.audit(actingUser, AuditAction.PROJECT_INVITE_RESENT, invite, project);
    return sent;
  }

  async revoke(
    projectId: string,
    inviteId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectInviteView> {
    const project = await this.projectsService.getManageableProject(projectId, actingUser, false);
    const invite = await this.findInProjectOrThrow(projectId, inviteId);
    if (invite.status === ProjectInviteStatus.ACCEPTED) {
      throw new ConflictException(
        'This invitation has already been accepted - remove the member instead',
      );
    }
    if (invite.status === ProjectInviteStatus.PENDING) {
      invite.status = ProjectInviteStatus.REVOKED;
      invite.revokedAt = new Date();
      invite.revokedBy = new Types.ObjectId(actingUser.id);
      await invite.save();
      await this.audit(actingUser, AuditAction.PROJECT_INVITE_REVOKED, invite, project);
    }
    await invite.populate('invitedBy', 'name');
    return toView(invite);
  }

  async preview(token: string): Promise<ProjectInvitePreview> {
    const invite = await this.model
      .findOne({ tokenHash: hashToken(token) })
      .populate('invitedBy', 'name')
      .exec();
    if (!invite) throw new NotFoundException('Invitation not found');
    const project = await this.projectsService.findActiveProject(extractId(invite.project));
    const organization = await this.organizationsService
      .getOrganizationDocument(extractId(invite.organizationId))
      .catch(() => null);
    const view = toView(invite);
    return {
      status: view.status,
      email: invite.email,
      role: invite.role,
      projectName: project?.name ?? 'a deleted project',
      organizationName: organization?.name ?? null,
      inviterName: view.invitedBy?.name ?? null,
      expiresAt: invite.expiresAt,
    };
  }

  /** The invitation link's sign-in: the token identifies the invite, so its state is reported
   * plainly (the preview page shows it anyway); the temporary password then has to match. */
  async acceptWithToken(token: string, temporaryPassword: string): Promise<UserDocument> {
    const invite = await this.model
      .findOne({ tokenHash: hashToken(token) })
      .select('+tempPasswordHash')
      .exec();
    if (!invite) throw new NotFoundException('Invitation not found');
    this.assertAcceptable(invite);
    if (!(await bcrypt.compare(temporaryPassword, invite.tempPasswordHash))) {
      throw new UnauthorizedException(MESSAGES.wrongPassword);
    }
    return this.accept(invite);
  }

  /**
   * Sign-in on the regular login form with an email that has no account yet: if it matches an
   * invite's temporary password, that accepts the invite. Returns null when nothing matched (the
   * caller then answers with its usual generic error), so an invite's existence or state is only
   * ever disclosed to someone who knows its temporary password.
   */
  async acceptByEmail(email: string, temporaryPassword: string): Promise<UserDocument | null> {
    const invites = await this.model
      .find({
        email: email.trim().toLowerCase(),
        status: { $in: [ProjectInviteStatus.PENDING, ProjectInviteStatus.REVOKED] },
      })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('+tempPasswordHash')
      .exec();
    for (const invite of invites) {
      if (await bcrypt.compare(temporaryPassword, invite.tempPasswordHash)) {
        this.assertAcceptable(invite, UnauthorizedException);
        return this.accept(invite);
      }
    }
    return null;
  }

  private assertAcceptable(
    invite: ProjectInviteDocument,
    // Login-form failures stay 401s (the login page shows the message as-is).
    Fail: new (message: string) => Error = GoneException,
  ): void {
    if (invite.status === ProjectInviteStatus.ACCEPTED) {
      throw new ConflictException(MESSAGES.accepted);
    }
    if (invite.status === ProjectInviteStatus.REVOKED) throw new Fail(MESSAGES.revoked);
    if (invite.expiresAt.getTime() <= Date.now()) throw new Fail(MESSAGES.expired);
  }

  private async accept(invite: ProjectInviteDocument): Promise<UserDocument> {
    const organizationId = extractId(invite.organizationId);
    await this.organizationsService.assertActive(organizationId).catch(() => {
      throw new UnauthorizedException('Organization is suspended');
    });
    const projectId = extractId(invite.project);
    const project = await this.projectsService.findActiveProject(projectId);
    if (!project) throw new GoneException(MESSAGES.projectGone);

    // Claim the invite atomically, so two simultaneous accepts can't both create the account.
    const claimed = await this.model
      .findOneAndUpdate(
        { _id: invite._id, status: ProjectInviteStatus.PENDING, expiresAt: { $gt: new Date() } },
        { status: ProjectInviteStatus.ACCEPTED, acceptedAt: new Date() },
      )
      .exec();
    if (!claimed) throw new ConflictException(MESSAGES.accepted);

    let user: UserDocument;
    try {
      user = await this.usersService.createFromInvite({
        name: invite.name ?? placeholderName(invite.email),
        email: invite.email,
        role: invite.role,
        organizationId,
        passwordHash: invite.tempPasswordHash,
      });
    } catch (err) {
      await this.model
        .updateOne({ _id: invite._id }, { status: ProjectInviteStatus.PENDING, acceptedAt: null })
        .exec();
      if (err instanceof ConflictException) {
        throw new ConflictException(
          'An account with this email already exists. Sign in with your own password.',
        );
      }
      throw err;
    }

    await this.model.updateOne({ _id: invite._id }, { acceptedUser: user._id }).exec();
    const inviterId = extractId(invite.invitedBy);
    await this.projectsService.addMemberFromInvite(projectId, user.id, inviterId);
    await this.auditLogService.record({
      organizationId,
      actorId: user.id,
      action: AuditAction.PROJECT_INVITE_ACCEPTED,
      targetType: 'ProjectInvite',
      targetId: invite.id,
      targetLabel: invite.email,
      metadata: { projectId, projectName: project.name, role: invite.role },
    });
    await this.notificationsService.notifyInviteAccepted({
      inviterId,
      organizationId,
      projectId,
      projectName: project.name,
      inviteeName: user.email,
    });
    return user;
  }

  private async assertEmailInvitable(email: string, projectId: string): Promise<void> {
    if (await this.usersService.isEmailRegistered(email)) {
      throw new ConflictException(
        'A user with this email already exists - add them as an existing member instead',
      );
    }
    const pending = await this.model
      .findOne({ email, status: ProjectInviteStatus.PENDING, expiresAt: { $gt: new Date() } })
      .exec();
    if (pending) {
      throw new ConflictException(
        extractId(pending.project) === projectId
          ? 'This email already has a pending invitation to this project - resend or revoke it'
          : 'This email already has a pending invitation to another project',
      );
    }
  }

  private async findInProjectOrThrow(
    projectId: string,
    inviteId: string,
  ): Promise<ProjectInviteDocument> {
    const invite = await this.model
      .findOne({ _id: inviteId, project: new Types.ObjectId(projectId) })
      .exec();
    if (!invite) throw new NotFoundException('Invitation not found');
    return invite;
  }

  private async deliver(
    invite: ProjectInviteDocument,
    project: ProjectDocument,
    token: string,
    temporaryPassword: string,
    actingUser: AuthenticatedUser,
  ): Promise<SentProjectInvite> {
    const appUrl = this.configService.get('appUrl', { infer: true }).replace(/\/$/, '');
    const inviteUrl = `${appUrl}/invite/${token}`;
    const [inviter, organization] = await Promise.all([
      this.usersService.findByIdOrThrow(actingUser.id),
      this.organizationsService
        .getOrganizationDocument(extractId(invite.organizationId))
        .catch(() => null),
    ]);
    const emailSent = await this.notificationsService.sendProjectInvite({
      inviteId: invite.id,
      email: invite.email,
      inviterName: inviter.name,
      role: invite.role,
      projectName: project.name,
      organizationName: organization?.name ?? null,
      inviteUrl,
      temporaryPassword,
      expiresAt: invite.expiresAt,
    });
    await invite.populate('invitedBy', 'name');
    return { invite: toView(invite), inviteUrl, temporaryPassword, emailSent };
  }

  private async audit(
    actingUser: AuthenticatedUser,
    action: AuditAction,
    invite: ProjectInviteDocument,
    project: ProjectDocument,
  ): Promise<void> {
    await this.auditLogService.record({
      organizationId: requireOrgId(actingUser),
      actorId: actingUser.id,
      action,
      targetType: 'ProjectInvite',
      targetId: invite.id,
      targetLabel: invite.email,
      metadata: { projectId: project.id, projectName: project.name, role: invite.role },
    });
  }
}

/** Until the invitee enters their own name (on their first sign-in): the email's local part. */
function placeholderName(email: string): string {
  return (email.split('@')[0] ?? '').slice(0, 60).padEnd(2, '_');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 12 characters with at least one letter and one digit - always meets the password policy. */
export function generateTemporaryPassword(): string {
  const all = TEMP_PASSWORD_LETTERS + TEMP_PASSWORD_DIGITS;
  const chars = [
    TEMP_PASSWORD_LETTERS[randomInt(TEMP_PASSWORD_LETTERS.length)]!,
    TEMP_PASSWORD_DIGITS[randomInt(TEMP_PASSWORD_DIGITS.length)]!,
    ...Array.from({ length: TEMP_PASSWORD_LENGTH - 2 }, () => all[randomInt(all.length)]!),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function toView(invite: ProjectInviteDocument): ProjectInviteView {
  const expired =
    invite.status === ProjectInviteStatus.PENDING && invite.expiresAt.getTime() <= Date.now();
  const inviter = invite.invitedBy as unknown as { _id?: Types.ObjectId; name?: string } | null;
  return {
    id: invite.id,
    projectId: extractId(invite.project),
    email: invite.email,
    name: invite.name,
    role: invite.role,
    status: expired ? 'Expired' : invite.status,
    expiresAt: invite.expiresAt,
    invitedBy:
      inviter && inviter.name && inviter._id
        ? { id: inviter._id.toString(), name: inviter.name }
        : null,
    resendCount: invite.resendCount,
    lastSentAt: invite.lastSentAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
  };
}
