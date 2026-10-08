import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ORG_ROLES, OrgRole, ProjectMemberRole, Role } from '../../common/enums/role.enum';
import {
  MemberPermissions,
  NO_PERMISSIONS,
  resolveMemberPermissions,
} from '../projects/schemas/member-permissions.schema';
import { Organization, OrganizationDocument } from '../organizations/schemas/organization.schema';
import {
  ProjectInvite,
  ProjectInviteDocument,
} from '../project-invites/schemas/project-invite.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';
import {
  CONFIGURABLE_BUILT_IN_ROLES,
  CustomRole,
  CustomRoleDocument,
  DEFAULT_CUSTOM_ROLES,
} from './schemas/custom-role.schema';

export interface CustomRoleView {
  id: string;
  name: string;
  description: string;
  color: string;
  accessLevel: string;
  permissions: MemberPermissions;
  /** 'Manager' / 'Developer' for the built-in roles' rows; null for a custom role. */
  builtInRole: ProjectMemberRole | null;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The role a user ends up with once a (built-in role, optional custom role) choice is resolved. */
export interface RoleAssignment {
  role: OrgRole;
  customRoleId: Types.ObjectId | null;
  /** Human label for audit logs: the custom role's name, else the built-in role. */
  label: string;
}

const BUILT_IN_DESCRIPTIONS: Record<ProjectMemberRole, string> = {
  [Role.MANAGER]:
    'Built-in. Creates and owns projects; these permissions add to that in projects they are a member of.',
  [Role.DEVELOPER]: 'Built-in. Works on tasks in the projects they belong to.',
};

@Injectable()
export class CustomRolesService {
  constructor(
    @InjectModel(CustomRole.name) private readonly model: Model<CustomRoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Organization.name) private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(ProjectInvite.name) private readonly inviteModel: Model<ProjectInviteDocument>,
  ) {}

  /** Built-in Manager/Developer first, then the custom roles by name. */
  async list(organizationId: string): Promise<CustomRoleView[]> {
    await this.ensureDefaults(organizationId);
    const orgId = new Types.ObjectId(organizationId);
    const [roles, customCounts, builtInCounts] = await Promise.all([
      this.model.find({ organizationId: orgId }).sort({ nameKey: 1 }).exec(),
      this.userModel
        .aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { organizationId: orgId, customRoleId: { $ne: null } } },
          { $group: { _id: '$customRoleId', count: { $sum: 1 } } },
        ])
        .exec(),
      this.userModel
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              organizationId: orgId,
              customRoleId: null,
              role: { $in: CONFIGURABLE_BUILT_IN_ROLES },
            },
          },
          { $group: { _id: '$role', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const countById = new Map(customCounts.map((c) => [c._id.toString(), c.count]));
    const countByBuiltIn = new Map(builtInCounts.map((c) => [c._id, c.count]));
    const views = roles.map((r) =>
      this.toView(
        r,
        r.builtInRole ? (countByBuiltIn.get(r.builtInRole) ?? 0) : (countById.get(r.id) ?? 0),
      ),
    );
    const order = (v: CustomRoleView) =>
      v.builtInRole ? CONFIGURABLE_BUILT_IN_ROLES.indexOf(v.builtInRole) : 99;
    return views.sort((a, b) => order(a) - order(b));
  }

  async create(organizationId: string, dto: CreateCustomRoleDto): Promise<CustomRoleView> {
    await this.ensureDefaults(organizationId);
    const name = dto.name.trim();
    await this.assertNameAvailable(organizationId, name);
    const created = await this.model.create({
      organizationId: new Types.ObjectId(organizationId),
      name,
      nameKey: name.toLowerCase(),
      description: dto.description?.trim() ?? '',
      color: dto.color ?? 'blue',
      accessLevel: dto.accessLevel,
      permissions: { ...NO_PERMISSIONS, ...dto.permissions },
      builtInRole: null,
    });
    return this.toView(created, 0);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateCustomRoleDto,
  ): Promise<{ role: CustomRoleView; previousName: string }> {
    const role = await this.findInOrgOrThrow(organizationId, id);
    const previousName = role.name;
    if (role.builtInRole) {
      // A built-in role keeps its name and access level - only what it may do is configurable.
      const renamed = dto.name !== undefined && dto.name.trim() !== role.name;
      const relevelled = dto.accessLevel !== undefined && dto.accessLevel !== role.accessLevel;
      if (renamed || relevelled) {
        throw new BadRequestException(
          'Built-in roles can only have their permissions, colour and description changed',
        );
      }
    }
    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== role.nameKey) {
      await this.assertNameAvailable(organizationId, dto.name.trim());
      role.name = dto.name.trim();
      role.nameKey = role.name.toLowerCase();
    }
    if (dto.description !== undefined) role.description = dto.description.trim();
    if (dto.color !== undefined) role.color = dto.color;
    if (dto.permissions !== undefined) role.permissions = { ...NO_PERMISSIONS, ...dto.permissions };
    const accessChanged = dto.accessLevel !== undefined && dto.accessLevel !== role.accessLevel;
    if (dto.accessLevel !== undefined) role.accessLevel = dto.accessLevel;
    await role.save();

    // Everyone holding the role moves to its new access level - the role defines it.
    if (accessChanged) {
      await this.userModel
        .updateMany(
          { organizationId: role.organizationId, customRoleId: role._id },
          { role: role.accessLevel },
        )
        .exec();
      await this.inviteModel
        .updateMany({ customRoleId: role._id, status: 'Pending' }, { role: role.accessLevel })
        .exec();
    }
    const memberCount = await this.countMembers(role);
    return { role: this.toView(role, memberCount), previousName };
  }

  async remove(organizationId: string, id: string): Promise<CustomRoleDocument> {
    const role = await this.findInOrgOrThrow(organizationId, id);
    if (role.builtInRole) throw new ForbiddenException('Built-in roles cannot be deleted');
    const memberCount = await this.countMembers(role);
    if (memberCount > 0) {
      throw new ConflictException(
        `${memberCount} ${memberCount === 1 ? 'user has' : 'users have'} this role - give ${
          memberCount === 1 ? 'them' : 'each of them'
        } another role first`,
      );
    }
    // Pending invites for the role fall back to its plain access level.
    await this.inviteModel.updateMany({ customRoleId: role._id }, { customRoleId: null }).exec();
    await role.deleteOne();
    return role;
  }

  /** A role of this organization only - roles never resolve across organizations. */
  async findInOrgOrThrow(organizationId: string, id: string): Promise<CustomRoleDocument> {
    const role = Types.ObjectId.isValid(id)
      ? await this.model
          .findOne({ _id: id, organizationId: new Types.ObjectId(organizationId) })
          .exec()
      : null;
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  /**
   * The role a user's permissions come from, with those (organization-wide) permissions: their
   * custom role, else their built-in Manager/Developer row. Null for Admins/PlatformAdmins (who
   * already hold every permission) and when nothing resolves.
   */
  async effectiveFor(
    user: Pick<UserDocument, 'role' | 'customRoleId' | 'organizationId'>,
  ): Promise<{ roleId: string; permissions: MemberPermissions } | null> {
    if (user.customRoleId) {
      const role = await this.model.findById(user.customRoleId).select('permissions').lean().exec();
      return role
        ? { roleId: user.customRoleId.toString(), permissions: resolveMemberPermissions(role) }
        : null;
    }
    if (
      !user.organizationId ||
      !CONFIGURABLE_BUILT_IN_ROLES.includes(user.role as ProjectMemberRole)
    ) {
      return null;
    }
    const row = await this.model
      .findOne({ organizationId: user.organizationId, builtInRole: user.role })
      .select('permissions')
      .lean()
      .exec();
    return row ? { roleId: row._id.toString(), permissions: resolveMemberPermissions(row) } : null;
  }

  async summaryFor(
    customRoleId: Types.ObjectId | string | null,
  ): Promise<Pick<CustomRoleView, 'id' | 'name' | 'color' | 'accessLevel' | 'permissions'> | null> {
    if (!customRoleId) return null;
    const role = await this.model.findById(customRoleId).exec();
    if (!role) return null;
    return {
      id: role.id,
      name: role.name,
      color: role.color,
      accessLevel: role.accessLevel,
      permissions: resolveMemberPermissions(role),
    };
  }

  /**
   * Resolves a role choice into what is stored on the user. With a custom role, the user's
   * built-in role becomes that role's access level (whatever `role` was sent); Admin can never be
   * combined with a custom role, and the built-in rows are not assignable as custom roles.
   */
  async resolveAssignment(
    organizationId: string,
    role: OrgRole,
    customRoleId?: string | null,
  ): Promise<RoleAssignment> {
    if (!customRoleId) return { role, customRoleId: null, label: role };
    if (role === Role.ADMIN) {
      throw new BadRequestException('Admins cannot also have a custom role');
    }
    const custom = await this.findInOrgOrThrow(organizationId, customRoleId);
    if (custom.builtInRole) {
      return { role: custom.builtInRole, customRoleId: null, label: custom.builtInRole };
    }
    if (!(ORG_ROLES as readonly string[]).includes(custom.accessLevel)) {
      throw new BadRequestException('That role has an invalid access level');
    }
    return { role: custom.accessLevel, customRoleId: custom._id, label: custom.name };
  }

  /**
   * Makes sure the organization has its built-in Manager/Developer rows (always) and the default
   * custom roles (once - deleting them all later keeps them deleted).
   */
  async ensureDefaults(organizationId: string): Promise<void> {
    const orgId = new Types.ObjectId(organizationId);
    await Promise.all(
      CONFIGURABLE_BUILT_IN_ROLES.map((builtInRole) =>
        this.model
          .updateOne(
            { organizationId: orgId, builtInRole },
            {
              $setOnInsert: {
                organizationId: orgId,
                builtInRole,
                name: builtInRole,
                nameKey: builtInRole.toLowerCase(),
                description: BUILT_IN_DESCRIPTIONS[builtInRole],
                color: 'slate',
                accessLevel: builtInRole,
                // No extra permissions: exactly today's behaviour until an Admin adds some.
                permissions: { ...NO_PERMISSIONS },
              },
            },
            { upsert: true },
          )
          .exec()
          .catch(() => {
            // A concurrent request inserted it first - the unique index keeps one.
          }),
      ),
    );

    const claimed = await this.orgModel
      .findOneAndUpdate(
        { _id: orgId, customRolesSeeded: { $ne: true } },
        { customRolesSeeded: true },
      )
      .exec();
    if (!claimed) return;
    const existing = await this.model
      .countDocuments({ organizationId: orgId, builtInRole: null })
      .exec();
    if (existing > 0) return;
    await this.model
      .insertMany(
        DEFAULT_CUSTOM_ROLES.map((r) => ({
          ...r,
          permissions: { ...NO_PERMISSIONS, ...r.permissions },
          organizationId: orgId,
          nameKey: r.name.toLowerCase(),
          builtInRole: null,
        })),
        { ordered: false },
      )
      .catch(() => {
        // A concurrent seed already inserted some - the unique index keeps one of each.
      });
  }

  private async assertNameAvailable(organizationId: string, name: string): Promise<void> {
    if ((ORG_ROLES as readonly string[]).some((r) => r.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`"${name}" is a built-in role name`);
    }
    const clash = await this.model
      .exists({ organizationId: new Types.ObjectId(organizationId), nameKey: name.toLowerCase() })
      .exec();
    if (clash) throw new ConflictException(`A role named "${name}" already exists`);
  }

  private countMembers(role: CustomRoleDocument): Promise<number> {
    if (role.builtInRole) {
      return this.userModel
        .countDocuments({
          organizationId: role.organizationId,
          role: role.builtInRole,
          customRoleId: null,
        })
        .exec();
    }
    return this.userModel.countDocuments({ customRoleId: role._id }).exec();
  }

  private toView(role: CustomRoleDocument, memberCount: number): CustomRoleView {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      color: role.color,
      accessLevel: role.accessLevel,
      permissions: resolveMemberPermissions(role),
      builtInRole: role.builtInRole ?? null,
      memberCount,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
