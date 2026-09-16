import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api } from './setup/fixtures';

const VALID_WORKFLOW_BODY = {
  name: 'Design Review Flow',
  description: 'Todo -> In Review -> Done',
  workflow: {
    statuses: [
      { name: 'Todo', category: StatusCategory.TODO },
      { name: 'In Review', category: StatusCategory.IN_PROGRESS },
      { name: 'Done', category: StatusCategory.DONE },
    ],
    transitions: [
      { from: 'Todo', to: 'In Review' },
      { from: 'In Review', to: 'Done' },
    ],
    initialStatus: 'Todo',
  },
};

/**
 * Covers the Platform-Admin-maintained workflow template library (Workflow Engine v2 / BRD
 * Section 5): idempotent seeding of the 3 named starter templates, any-authenticated-user read
 * access (an Org Admin needs to browse the library), and Platform-Admin-only write access.
 */
describe('workflow templates library (integration)', () => {
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

  async function seedPlatformAdmin(email: string) {
    return seedUserAndLogin(app, {
      email,
      password: 'Password123',
      role: Role.PLATFORM_ADMIN,
      organizationId: null,
    });
  }

  async function seedOrgAdmin(email: string) {
    const org = await seedOrganization(app);
    return seedUserAndLogin(app, {
      email,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
  }

  it('seeds the 3 named starter templates the first time anyone lists them', async () => {
    const orgAdmin = await seedOrgAdmin('wf-tpl-org-admin@example.com');

    const list = await api(app)
      .get(`/${API_PREFIX}/workflow-templates`)
      .set(...authHeader(orgAdmin.accessToken));
    expect(list.status).toBe(200);
    const names = (list.body.data as Array<{ name: string }>).map((t) => t.name);
    expect(names.sort()).toEqual(['Bug Tracking', 'Dev Task', 'Simple Support']);

    // Idempotent: listing again does not duplicate the seed.
    const listAgain = await api(app)
      .get(`/${API_PREFIX}/workflow-templates`)
      .set(...authHeader(orgAdmin.accessToken));
    expect(listAgain.body.data).toHaveLength(3);
  });

  it('a Platform Admin can create, update, and delete a template (full CRUD)', async () => {
    const platformAdmin = await seedPlatformAdmin('wf-tpl-platform-admin@example.com');

    const create = await api(app)
      .post(`/${API_PREFIX}/workflow-templates`)
      .set(...authHeader(platformAdmin.accessToken))
      .send(VALID_WORKFLOW_BODY);
    expect(create.status).toBe(201);
    expect(create.body.data.name).toBe('Design Review Flow');
    const templateId = create.body.data.id;

    const update = await api(app)
      .patch(`/${API_PREFIX}/workflow-templates/${templateId}`)
      .set(...authHeader(platformAdmin.accessToken))
      .send({ description: 'Updated description' });
    expect(update.status).toBe(200);
    expect(update.body.data.description).toBe('Updated description');

    const del = await api(app)
      .delete(`/${API_PREFIX}/workflow-templates/${templateId}`)
      .set(...authHeader(platformAdmin.accessToken));
    expect(del.status).toBe(204);

    const afterDelete = await api(app)
      .patch(`/${API_PREFIX}/workflow-templates/${templateId}`)
      .set(...authHeader(platformAdmin.accessToken))
      .send({ description: 'should 404' });
    expect(afterDelete.status).toBe(404);
  });

  it('rejects an invalid workflow shape on create (initialStatus not among the statuses)', async () => {
    const platformAdmin = await seedPlatformAdmin('wf-tpl-invalid@example.com');

    const res = await api(app)
      .post(`/${API_PREFIX}/workflow-templates`)
      .set(...authHeader(platformAdmin.accessToken))
      .send({
        name: 'Bad template',
        workflow: {
          statuses: [{ name: 'Todo', category: StatusCategory.TODO }],
          transitions: [],
          initialStatus: 'Done',
        },
      });
    expect(res.status).toBe(400);
  });

  it('an Org Admin can read the library but cannot create, update, or delete a template', async () => {
    const orgAdmin = await seedOrgAdmin('wf-tpl-org-admin-write@example.com');

    const read = await api(app)
      .get(`/${API_PREFIX}/workflow-templates`)
      .set(...authHeader(orgAdmin.accessToken));
    expect(read.status).toBe(200);

    const create = await api(app)
      .post(`/${API_PREFIX}/workflow-templates`)
      .set(...authHeader(orgAdmin.accessToken))
      .send(VALID_WORKFLOW_BODY);
    expect(create.status).toBe(403);

    const seededId = read.body.data[0].id;
    const update = await api(app)
      .patch(`/${API_PREFIX}/workflow-templates/${seededId}`)
      .set(...authHeader(orgAdmin.accessToken))
      .send({ description: 'nope' });
    expect(update.status).toBe(403);

    const del = await api(app)
      .delete(`/${API_PREFIX}/workflow-templates/${seededId}`)
      .set(...authHeader(orgAdmin.accessToken));
    expect(del.status).toBe(403);
  });
});
