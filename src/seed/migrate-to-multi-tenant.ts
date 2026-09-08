import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import * as bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import configuration from '../config/configuration';

loadEnv();
import { Role } from '../common/enums/role.enum';
import { OrganizationStatus } from '../common/enums/organization-status.enum';
import { User, UserSchema } from '../modules/users/schemas/user.schema';
import { Project, ProjectSchema } from '../modules/projects/schemas/project.schema';
import { Task, TaskSchema } from '../modules/tasks/schemas/task.schema';
import {
  Organization,
  OrganizationSchema,
} from '../modules/organizations/schemas/organization.schema';

const config = configuration();

const DEFAULT_ORG_SLUG = 'default';
const DEFAULT_ORG_NAME = 'Default Organization';

/**
 * One-time (but safely re-runnable) migration for the multi-tenancy retrofit. Every step only
 * ever *sets* organizationId where it is currently missing - it never overwrites an
 * already-set value - so this is safe to run repeatedly against the same database.
 */
async function main() {
  await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
  console.log(`connected to ${config.mongo.uri}/${config.mongo.dbName}`);

  const OrganizationModel = mongoose.model(Organization.name, OrganizationSchema);
  const UserModel = mongoose.model(User.name, UserSchema);
  const ProjectModel = mongoose.model(Project.name, ProjectSchema);
  const TaskModel = mongoose.model(Task.name, TaskSchema);

  let defaultOrg = await OrganizationModel.findOne({ slug: DEFAULT_ORG_SLUG });
  if (!defaultOrg) {
    defaultOrg = await OrganizationModel.create({
      name: DEFAULT_ORG_NAME,
      slug: DEFAULT_ORG_SLUG,
      status: OrganizationStatus.ACTIVE,
    });
    console.log(`created: ${DEFAULT_ORG_NAME} (${defaultOrg.id})`);
  } else {
    console.log(`skip (exists): ${DEFAULT_ORG_NAME} (${defaultOrg.id})`);
  }

  const userResult = await UserModel.updateMany(
    { organizationId: null, role: { $ne: Role.PLATFORM_ADMIN } },
    { organizationId: defaultOrg._id },
  );
  console.log(`users backfilled into default org: ${userResult.modifiedCount}`);

  const projectResult = await ProjectModel.updateMany(
    { organizationId: null },
    { organizationId: defaultOrg._id },
  );
  console.log(`projects backfilled into default org: ${projectResult.modifiedCount}`);

  const taskResult = await TaskModel.updateMany(
    { organizationId: null },
    { organizationId: defaultOrg._id },
  );
  console.log(`tasks backfilled into default org: ${taskResult.modifiedCount}`);

  const platformAdminEmail = config.platformAdmin.email.toLowerCase();
  const existingByEmail = await UserModel.findOne({ email: platformAdminEmail });

  if (!existingByEmail) {
    const passwordHash = await bcrypt.hash(config.platformAdmin.password, config.bcryptSaltRounds);
    await UserModel.create({
      name: 'Platform Admin',
      email: platformAdminEmail,
      passwordHash,
      role: Role.PLATFORM_ADMIN,
      organizationId: null,
      isActive: true,
    });
    console.log(`created: ${platformAdminEmail} (PlatformAdmin)`);
  } else if (existingByEmail.role !== Role.PLATFORM_ADMIN) {
    // Never silently repurpose an existing org user into a platform admin - that would rip
    // them out of their organization's membership as a side effect of this migration. The
    // operator must pick an email that isn't already in use by an org user.
    throw new Error(
      `PLATFORM_ADMIN_EMAIL (${platformAdminEmail}) already belongs to an existing user with ` +
        `role "${existingByEmail.role}". Choose a different, unused email for the platform ` +
        'admin and re-run this migration; refusing to overwrite an existing org user.',
    );
  } else {
    console.log(`skip (exists): ${platformAdminEmail} (PlatformAdmin)`);
  }

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
