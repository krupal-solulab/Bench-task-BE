import { PartialType } from '@nestjs/swagger';
import { CreateWorkLogDto } from './create-work-log.dto';

export class UpdateWorkLogDto extends PartialType(CreateWorkLogDto) {}
