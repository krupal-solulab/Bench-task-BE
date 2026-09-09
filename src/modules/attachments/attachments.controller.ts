import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AttachmentsService } from './attachments.service';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Extensions that could be executed if downloaded and run - rejected regardless of the
// declared MIME type, since that's client-supplied and trivially spoofable.
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.msi',
  '.com',
  '.scr',
  '.jar',
  '.app',
  '.dll',
]);

@ApiTags('attachments')
@ApiBearerAuth()
@Controller()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'Upload a file attachment to a task (project members only)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
        if (BLOCKED_EXTENSIONS.has(extension)) {
          callback(new BadRequestException(`File type "${extension}" is not allowed`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async upload(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    return this.attachmentsService.upload(taskId, file, user);
  }

  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'List attachments for a task (paginated)' })
  async list(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachmentsService.paginateForTask(taskId, query.page, query.limit, user);
  }

  @Get('attachments/:id/download')
  @ApiOperation({ summary: 'Get a short-lived presigned download URL for an attachment' })
  async download(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    const url = await this.attachmentsService.getDownloadUrl(id, user);
    return { url };
  }

  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete own attachment (Admin/Manager of the same org may delete any)' })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.attachmentsService.remove(id, user);
  }
}
