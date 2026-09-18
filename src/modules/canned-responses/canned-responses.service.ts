import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CannedResponsesRepository } from './canned-responses.repository';
import { CannedResponseDocument } from './schemas/canned-response.schema';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';

@Injectable()
export class CannedResponsesService {
  constructor(private readonly cannedResponsesRepository: CannedResponsesRepository) {}

  async create(
    dto: CreateCannedResponseDto,
    actingUser: AuthenticatedUser,
  ): Promise<CannedResponseDocument> {
    return this.cannedResponsesRepository.create({
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
      createdBy: new Types.ObjectId(actingUser.id),
      title: dto.title.trim(),
      body: dto.body.trim(),
    });
  }

  list(actingUser: AuthenticatedUser): Promise<CannedResponseDocument[]> {
    return this.cannedResponsesRepository.findAllForOrg(requireOrgId(actingUser));
  }

  async update(
    id: string,
    dto: UpdateCannedResponseDto,
    actingUser: AuthenticatedUser,
  ): Promise<CannedResponseDocument> {
    // Org-shared, no ownership check (see the schema's own doc comment) - any org member may
    // edit any canned response, matching this feature's deliberately low-stakes scope.
    await this.getInOrgOrThrow(id, actingUser);
    const updated = await this.cannedResponsesRepository.updateById(id, {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
    });
    return updated!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getInOrgOrThrow(id, actingUser);
    await this.cannedResponsesRepository.deleteById(id);
  }

  private async getInOrgOrThrow(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<CannedResponseDocument> {
    const entry = await this.cannedResponsesRepository.findByIdInOrg(id, requireOrgId(actingUser));
    if (!entry) throw new NotFoundException('Canned response not found');
    return entry;
  }
}
