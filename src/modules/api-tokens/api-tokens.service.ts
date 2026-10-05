import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { extractId } from '../../common/utils/mongo.util';
import { UsersService } from '../users/users.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ApiToken, ApiTokenDocument } from './schemas/api-token.schema';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

export const API_TOKEN_PREFIX = 'pat_';
const MAX_ACTIVE_TOKENS_PER_USER = 20;
const DEFAULT_EXPIRY_DAYS = 90;
/** lastUsedAt is refreshed at most this often, so authenticating doesn't write on every call. */
const LAST_USED_RESOLUTION_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Module 11 gap-closure: personal API tokens. A token acts as its owner (same role, same org,
 * same permissions everywhere), only while the owner and their org stay active, until it expires
 * or is revoked. Token-management, password/profile, logout and impersonation routes refuse it
 * (`@DisallowApiToken`).
 */
@Injectable()
export class ApiTokensService {
  constructor(
    @InjectModel(ApiToken.name) private readonly tokenModel: Model<ApiTokenDocument>,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async create(
    dto: CreateApiTokenDto,
    actingUser: AuthenticatedUser,
  ): Promise<{ token: string; apiToken: ApiTokenDocument }> {
    const organizationId = requireOrgId(actingUser);
    const active = await this.tokenModel.countDocuments({
      owner: new Types.ObjectId(actingUser.id),
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });
    if (active >= MAX_ACTIVE_TOKENS_PER_USER) {
      throw new BadRequestException(
        `You already have ${MAX_ACTIVE_TOKENS_PER_USER} active tokens - revoke one first`,
      );
    }

    const raw = `${API_TOKEN_PREFIX}${randomBytes(30).toString('base64url')}`;
    const days = dto.expiresInDays === undefined ? DEFAULT_EXPIRY_DAYS : dto.expiresInDays;
    const apiToken = await this.tokenModel.create({
      organizationId: new Types.ObjectId(organizationId),
      owner: new Types.ObjectId(actingUser.id),
      name: dto.name.trim(),
      tokenHash: hashToken(raw),
      prefix: raw.slice(0, API_TOKEN_PREFIX.length + 8),
      expiresAt: days === null ? null : new Date(Date.now() + days * DAY_MS),
    });
    return { token: raw, apiToken };
  }

  listMine(actingUser: AuthenticatedUser): Promise<ApiTokenDocument[]> {
    return this.tokenModel
      .find({ owner: new Types.ObjectId(actingUser.id), revokedAt: null })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Admin view: every unrevoked token in the org, with its owner. */
  listOrg(actingUser: AuthenticatedUser): Promise<ApiTokenDocument[]> {
    return this.tokenModel
      .find({ organizationId: new Types.ObjectId(requireOrgId(actingUser)), revokedAt: null })
      .populate('owner', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Revokes one of the caller's own tokens - or, with `asAdmin`, any token in their org. */
  async revoke(
    id: string,
    actingUser: AuthenticatedUser,
    asAdmin = false,
  ): Promise<ApiTokenDocument> {
    const token = await this.tokenModel.findOne({ _id: id, revokedAt: null }).exec();
    const owns = token && extractId(token.owner) === actingUser.id;
    const sameOrgAdmin =
      token && asAdmin && extractId(token.organizationId) === requireOrgId(actingUser);
    if (!token || !(owns || sameOrgAdmin)) throw new NotFoundException('API token not found');
    token.revokedAt = new Date();
    return token.save();
  }

  /**
   * Resolves a raw `pat_...` secret to the user it acts as, or null if it's unknown, revoked,
   * expired, or its owner/org is no longer active - the same liveness checks a normal session
   * gets in JwtStrategy.
   */
  async authenticate(raw: string): Promise<AuthenticatedUser | null> {
    if (!raw.startsWith(API_TOKEN_PREFIX)) return null;
    const token = await this.tokenModel
      .findOne({ tokenHash: hashToken(raw), revokedAt: null })
      .exec();
    if (!token || (token.expiresAt && token.expiresAt.getTime() <= Date.now())) return null;

    const user = await this.usersService.findByIdOrThrow(extractId(token.owner)).catch(() => null);
    if (!user || !user.isActive) return null;
    const organizationId = user.organizationId ? user.organizationId.toString() : null;
    if (!organizationId || organizationId !== extractId(token.organizationId)) return null;
    try {
      await this.organizationsService.assertActive(organizationId);
    } catch {
      return null;
    }

    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.tokenModel.updateOne({ _id: token._id }, { lastUsedAt: new Date() }).exec();
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId,
      viaApiToken: token.id,
    };
  }
}
