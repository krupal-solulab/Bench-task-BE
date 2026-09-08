import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import * as bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import configuration from '../config/configuration';

loadEnv();
import { Role } from '../common/enums/role.enum';
import { TaskPriority } from '../common/enums/task-priority.enum';
import { OrganizationStatus } from '../common/enums/organization-status.enum';
import { User, UserSchema } from '../modules/users/schemas/user.schema';
import { Project, ProjectSchema } from '../modules/projects/schemas/project.schema';
import { Task, TaskSchema } from '../modules/tasks/schemas/task.schema';
import {
  Organization,
  OrganizationDocument,
  OrganizationSchema,
} from '../modules/organizations/schemas/organization.schema';

const config = configuration();

async function upsertUser(
  model: mongoose.Model<User>,
  name: string,
  email: string,
  password: string,
  role: Role,
  organizationId: mongoose.Types.ObjectId | null,
) {
  const existing = await model.findOne({ email });
  if (existing) {
    console.log(`skip (exists): ${email}`);
    return existing;
  }
  const passwordHash = await bcrypt.hash(password, config.bcryptSaltRounds);
  const user = await model.create({
    name,
    email,
    passwordHash,
    role,
    organizationId,
    isActive: true,
  });
  console.log(`created: ${email} (${role})`);
  return user;
}

async function main() {
  await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
  console.log(`connected to ${config.mongo.uri}/${config.mongo.dbName}`);

  const OrganizationModel = mongoose.model(Organization.name, OrganizationSchema);
  const UserModel = mongoose.model(User.name, UserSchema);
  const ProjectModel = mongoose.model(Project.name, ProjectSchema);
  const TaskModel = mongoose.model(Task.name, TaskSchema);

  // Distinct name/slug from migrate-to-multi-tenant.ts's "Default Organization" - that script
  // retrofits an existing single-tenant database, this one seeds a fresh dev database, and the
  // two should never be confused for one another.
  let demoOrg: OrganizationDocument | null = await OrganizationModel.findOne({ slug: 'demo' });
  if (!demoOrg) {
    demoOrg = await OrganizationModel.create({
      name: 'Demo Organization',
      slug: 'demo',
      status: OrganizationStatus.ACTIVE,
    });
    console.log(`created: Demo Organization (${demoOrg.id})`);
  } else {
    console.log(`skip (exists): Demo Organization (${demoOrg.id})`);
  }

  await upsertUser(
    UserModel,
    'Platform Admin',
    config.platformAdmin.email,
    config.platformAdmin.password,
    Role.PLATFORM_ADMIN,
    null,
  );
  await upsertUser(
    UserModel,
    'Admin User',
    config.seedAdmin.email,
    config.seedAdmin.password,
    Role.ADMIN,
    demoOrg._id,
  );
  const manager = await upsertUser(
    UserModel,
    'Morgan Manager',
    'manager@example.com',
    'Manager@12345',
    Role.MANAGER,
    demoOrg._id,
  );
  const developer = await upsertUser(
    UserModel,
    'Dana Developer',
    'developer@example.com',
    'Developer@12345',
    Role.DEVELOPER,
    demoOrg._id,
  );

  const existingProject = await ProjectModel.findOne({ name: 'Demo Project' });
  if (!existingProject) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const project = await ProjectModel.create({
      name: 'Demo Project',
      description: 'Seeded sample project for reviewing the app.',
      owner: manager._id,
      members: [{ user: developer._id, joinedAt: new Date() }],
      startDate: new Date(),
      dueDate,
      organizationId: demoOrg._id,
    });

    await TaskModel.create([
      {
        title: 'Set up project scaffolding',
        description: 'Initial repo structure and tooling.',
        project: project._id,
        assignee: developer._id,
        priority: TaskPriority.P2,
        createdBy: manager._id,
        organizationId: demoOrg._id,
      },
      {
        title: 'Design the database schema',
        description: 'Model users, projects, tasks, comments.',
        project: project._id,
        assignee: developer._id,
        priority: TaskPriority.P1,
        createdBy: manager._id,
        organizationId: demoOrg._id,
      },
    ]);
    console.log('created: Demo Project with 2 sample tasks');
  } else {
    console.log('skip (exists): Demo Project');
  }

  console.log('\nDemo credentials:');
  console.log(`  Platform Admin: ${config.platformAdmin.email} / ${config.platformAdmin.password}`);
  console.log(`  Admin:          ${config.seedAdmin.email} / ${config.seedAdmin.password}`);
  console.log('  Manager:        manager@example.com / Manager@12345');
  console.log('  Developer:      developer@example.com / Developer@12345');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
