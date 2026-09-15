import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTaskDto } from './create-task.dto';

// issueType/parent are fixed at creation - changing an issue's hierarchy position after the fact
// (e.g. turning a Sub-task into a Story) needs its own re-validation pass, out of scope for now.
export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['project', 'assignee', 'issueType', 'parent'] as const),
) {}
