import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import * as bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import configuration from '../config/configuration';

loadEnv();
import { Role } from '../common/enums/role.enum';
import { TaskPriority } from '../common/enums/task-priority.enum';
import { User, UserSchema } from '../modules/users/schemas/user.schema';
import { Project, ProjectSchema } from '../modules/projects/schemas/project.schema';
import { Task, TaskSchema } from '../modules/tasks/schemas/task.schema';

const config = configuration();

async function upsertUser(
  model: mongoose.Model<User>,
  name: string,
  email: string,
  password: string,
  role: Role,
) {
  const existing = await model.findOne({ email });
  if (existing) {
    console.log(`skip (exists): ${email}`);
    return existing;
  }
  const passwordHash = await bcrypt.hash(password, config.bcryptSaltRounds);
  const user = await model.create({ name, email, passwordHash, role, isActive: true });
  console.log(`created: ${email} (${role})`);
  return user;
}

async function main() {
  await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
  console.log(`connected to ${config.mongo.uri}/${config.mongo.dbName}`);

  const UserModel = mongoose.model(User.name, UserSchema);
  const ProjectModel = mongoose.model(Project.name, ProjectSchema);
  const TaskModel = mongoose.model(Task.name, TaskSchema);

  await upsertUser(
    UserModel,
    'Admin User',
    config.seedAdmin.email,
    config.seedAdmin.password,
    Role.ADMIN,
  );
  const manager = await upsertUser(
    UserModel,
    'Morgan Manager',
    'manager@example.com',
    'Manager@12345',
    Role.MANAGER,
  );
  const developer = await upsertUser(
    UserModel,
    'Dana Developer',
    'developer@example.com',
    'Developer@12345',
    Role.DEVELOPER,
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
    });

    await TaskModel.create([
      {
        title: 'Set up project scaffolding',
        description: 'Initial repo structure and tooling.',
        project: project._id,
        assignee: developer._id,
        priority: TaskPriority.P2,
        createdBy: manager._id,
      },
      {
        title: 'Design the database schema',
        description: 'Model users, projects, tasks, comments.',
        project: project._id,
        assignee: developer._id,
        priority: TaskPriority.P1,
        createdBy: manager._id,
      },
    ]);
    console.log('created: Demo Project with 2 sample tasks');
  } else {
    console.log('skip (exists): Demo Project');
  }

  console.log('\nDemo credentials:');
  console.log(`  Admin:     ${config.seedAdmin.email} / ${config.seedAdmin.password}`);
  console.log('  Manager:   manager@example.com / Manager@12345');
  console.log('  Developer: developer@example.com / Developer@12345');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
