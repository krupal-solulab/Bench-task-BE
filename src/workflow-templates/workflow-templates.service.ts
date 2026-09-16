import { Injectable, NotFoundException } from '@nestjs/common';
import { StatusCategory } from '../common/enums/status-category.enum';
import { TaskStatus } from '../common/enums/task-status.enum';
import {
  DEFAULT_WORKFLOW,
  Workflow,
  assertValidWorkflowShape,
} from '../modules/projects/schemas/workflow.schema';
import { WorkflowTemplatesRepository } from './workflow-templates.repository';
import { WorkflowTemplate, WorkflowTemplateDocument } from './schemas/workflow-template.schema';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto';

/** The BRD's 3 named starter workflows - seeded once, idempotently, the first time anyone lists
 * templates against an empty collection. "Dev Task" is byte-identical to the system's own
 * DEFAULT_WORKFLOW, so a project that clones it and never edits it behaves exactly like a project
 * with no custom workflow at all. */
const SEED_TEMPLATES: Array<{ name: string; description: string; workflow: Workflow }> = [
  {
    name: 'Simple Support',
    description: 'Todo -> In Progress -> Done',
    workflow: {
      statuses: [
        { name: TaskStatus.TODO, category: StatusCategory.TODO },
        { name: TaskStatus.IN_PROGRESS, category: StatusCategory.IN_PROGRESS },
        { name: TaskStatus.DONE, category: StatusCategory.DONE },
      ],
      transitions: [
        { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
        { from: TaskStatus.IN_PROGRESS, to: TaskStatus.DONE },
        { from: TaskStatus.IN_PROGRESS, to: TaskStatus.TODO },
      ],
      initialStatus: TaskStatus.TODO,
    },
  },
  {
    name: 'Bug Tracking',
    description: 'Todo -> In Progress -> Needs QA -> Done',
    workflow: {
      statuses: [
        { name: TaskStatus.TODO, category: StatusCategory.TODO },
        { name: TaskStatus.IN_PROGRESS, category: StatusCategory.IN_PROGRESS },
        { name: 'Needs QA', category: StatusCategory.IN_PROGRESS },
        { name: TaskStatus.DONE, category: StatusCategory.DONE },
      ],
      transitions: [
        { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
        { from: TaskStatus.IN_PROGRESS, to: 'Needs QA' },
        { from: 'Needs QA', to: TaskStatus.DONE },
        { from: 'Needs QA', to: TaskStatus.IN_PROGRESS },
        { from: TaskStatus.IN_PROGRESS, to: TaskStatus.TODO },
      ],
      initialStatus: TaskStatus.TODO,
    },
  },
  {
    name: 'Dev Task',
    description: "The system's own default workflow: Todo -> In Progress -> Review -> Done",
    workflow: DEFAULT_WORKFLOW,
  },
];

@Injectable()
export class WorkflowTemplatesService {
  constructor(private readonly repository: WorkflowTemplatesRepository) {}

  async listAll(): Promise<WorkflowTemplateDocument[]> {
    await this.ensureSeeded();
    return this.repository.findAll();
  }

  async create(dto: CreateWorkflowTemplateDto): Promise<WorkflowTemplateDocument> {
    const workflow = this.toWorkflow(dto.workflow);
    assertValidWorkflowShape(workflow);
    return this.repository.create({
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      workflow,
    });
  }

  async update(id: string, dto: UpdateWorkflowTemplateDto): Promise<WorkflowTemplateDocument> {
    await this.getOrThrow(id);
    const update: Partial<WorkflowTemplate> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.description !== undefined) update.description = dto.description.trim();
    if (dto.workflow !== undefined) {
      const workflow = this.toWorkflow(dto.workflow);
      assertValidWorkflowShape(workflow);
      update.workflow = workflow;
    }
    return (await this.repository.updateById(id, update))!;
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.repository.deleteById(id);
  }

  private toWorkflow(dto: CreateWorkflowTemplateDto['workflow']): Workflow {
    return {
      statuses: dto.statuses,
      transitions: dto.transitions,
      initialStatus: dto.initialStatus,
    };
  }

  private async getOrThrow(id: string): Promise<WorkflowTemplateDocument> {
    const template = await this.repository.findById(id);
    if (!template) throw new NotFoundException('Workflow template not found');
    return template;
  }

  /** Idempotent - a no-op once the collection has at least one template, so seeding never
   * overwrites an Admin's own edits/deletions. */
  private async ensureSeeded(): Promise<void> {
    const count = await this.repository.count();
    if (count > 0) return;
    await this.repository.insertMany(SEED_TEMPLATES);
  }
}
