import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { WorkflowTemplatesRepository } from 'src/workflow-templates/workflow-templates.repository';
import { WorkflowTemplatesService } from 'src/workflow-templates/workflow-templates.service';
import { WorkflowTemplateDocument } from 'src/workflow-templates/schemas/workflow-template.schema';

function makeTemplate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'template-1',
    name: 'Simple Support',
    description: 'Todo -> In Progress -> Done',
    workflow: {
      statuses: [
        { name: 'Todo', category: StatusCategory.TODO },
        { name: 'Done', category: StatusCategory.DONE },
      ],
      transitions: [{ from: 'Todo', to: 'Done' }],
      initialStatus: 'Todo',
    },
    ...overrides,
  } as unknown as WorkflowTemplateDocument;
}

describe('WorkflowTemplatesService', () => {
  let repository: jest.Mocked<
    Pick<
      WorkflowTemplatesRepository,
      'create' | 'insertMany' | 'findById' | 'findAll' | 'count' | 'updateById' | 'deleteById'
    >
  >;
  let service: WorkflowTemplatesService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      insertMany: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
      updateById: jest.fn(),
      deleteById: jest.fn(),
    };
    service = new WorkflowTemplatesService(repository as unknown as WorkflowTemplatesRepository);
  });

  describe('listAll (idempotent seeding)', () => {
    it('seeds the 3 named starter templates when the collection is empty', async () => {
      repository.count.mockResolvedValue(0);
      repository.findAll.mockResolvedValue([makeTemplate()]);

      await service.listAll();

      expect(repository.insertMany).toHaveBeenCalledTimes(1);
      const seeded = repository.insertMany.mock.calls[0]![0] as Array<{ name: string }>;
      expect(seeded.map((t) => t.name)).toEqual(['Simple Support', 'Bug Tracking', 'Dev Task']);
    });

    it('does not re-seed when templates already exist', async () => {
      repository.count.mockResolvedValue(3);
      repository.findAll.mockResolvedValue([makeTemplate()]);

      await service.listAll();

      expect(repository.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('rejects a workflow with no statuses', async () => {
      await expect(
        service.create({
          name: 'Bad',
          workflow: { statuses: [], transitions: [], initialStatus: 'Todo' },
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects an initialStatus not among the statuses', async () => {
      await expect(
        service.create({
          name: 'Bad',
          workflow: {
            statuses: [{ name: 'Todo', category: StatusCategory.TODO }],
            transitions: [],
            initialStatus: 'Done',
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a valid template', async () => {
      repository.create.mockResolvedValue(makeTemplate());
      await service.create({
        name: 'Simple Support',
        description: 'Todo -> Done',
        workflow: {
          statuses: [
            { name: 'Todo', category: StatusCategory.TODO },
            { name: 'Done', category: StatusCategory.DONE },
          ],
          transitions: [{ from: 'Todo', to: 'Done' }],
          initialStatus: 'Todo',
        },
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Simple Support' }),
      );
    });
  });

  describe('update / remove', () => {
    it('rejects updating a template that does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.update('template-1', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('rejects removing a template that does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.remove('template-1')).rejects.toThrow(NotFoundException);
      expect(repository.deleteById).not.toHaveBeenCalled();
    });

    it('deletes an existing template', async () => {
      repository.findById.mockResolvedValue(makeTemplate());
      await service.remove('template-1');
      expect(repository.deleteById).toHaveBeenCalledWith('template-1');
    });
  });
});
