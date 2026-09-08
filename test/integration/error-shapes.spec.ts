import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject } from './setup/fixtures';

/** Every error response, regardless of status code, must share this shape (AllExceptionsFilter). */
function expectStandardErrorShape(body: unknown, expectedStatus: number) {
  expect(body).toMatchObject({
    statusCode: expectedStatus,
    message: expect.any(String),
    error: expect.any(String),
    timestamp: expect.any(String),
    path: expect.any(String),
  });
}

describe('error response shapes (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  afterEach(async () => {
    await clearInMemoryMongo();
  });

  it('400: a missing required field fails validation', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'err-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const res = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(manager.accessToken))
      .send({}); // `name` is required
    expect(res.status).toBe(400);
    expectStandardErrorShape(res.body, 400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.stringContaining('name')]));
  });

  it('400: an extra, non-whitelisted field is rejected (forbidNonWhitelisted)', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'err-manager-2@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const res = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Valid Name', notAllowedField: 'nope' });
    expect(res.status).toBe(400);
    expectStandardErrorShape(res.body, 400);
  });

  it('400: a malformed ObjectId in a route param is a 400, not a 500', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'err-manager-3@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const res = await api(app)
      .get(`/${API_PREFIX}/projects/not-an-object-id`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(400);
    expectStandardErrorShape(res.body, 400);
  });

  it('401: no token on a protected route', async () => {
    const res = await api(app).get(`/${API_PREFIX}/projects`);
    expect(res.status).toBe(401);
    expectStandardErrorShape(res.body, 401);
  });

  it('401: an invalid/garbage token on a protected route', async () => {
    const res = await api(app)
      .get(`/${API_PREFIX}/projects`)
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expectStandardErrorShape(res.body, 401);
  });

  it('403: wrong role on a role-gated route', async () => {
    const org = await seedOrganization(app);
    const developer = await seedUserAndLogin(app, {
      email: 'err-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const res = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Should be forbidden' });
    expect(res.status).toBe(403);
    expectStandardErrorShape(res.body, 403);
  });

  it('404: a well-formed but nonexistent ObjectId', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'err-manager-4@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const res = await api(app)
      .get(`/${API_PREFIX}/projects/507f1f77bcf86cd799439011`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(404);
    expectStandardErrorShape(res.body, 404);
  });

  it('409: an illegal project status transition', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'err-manager-5@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Conflict Project' });
    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: ProjectStatus.COMPLETED });
    expect(res.status).toBe(409);
    expectStandardErrorShape(res.body, 409);
  });

  it('409: duplicate email on register-organization', async () => {
    // Email uniqueness is global across organizations, so a second org registering with the
    // same adminEmail must still 409.
    await api(app).post(`/${API_PREFIX}/auth/register-organization`).send({
      organizationName: 'Dupe Error Org One',
      adminName: 'First',
      adminEmail: 'dupe-error@example.com',
      adminPassword: 'Password123',
    });
    const res = await api(app).post(`/${API_PREFIX}/auth/register-organization`).send({
      organizationName: 'Dupe Error Org Two',
      adminName: 'Second',
      adminEmail: 'dupe-error@example.com',
      adminPassword: 'Password123',
    });
    expect(res.status).toBe(409);
    expectStandardErrorShape(res.body, 409);
  });

  it('reference: a valid task create still succeeds (sanity check that the DTO used above is otherwise correct)', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'err-manager-6@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Sanity Project' });
    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Valid task', project: project.id, priority: TaskPriority.P2 });
    expect(res.status).toBe(201);
  });
});
