import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RefreshToken, RefreshTokenDocument } from './schemas/refresh-token.schema';

@Injectable()
export class AuthRepository {
  constructor(
    @InjectModel(RefreshToken.name) private readonly model: Model<RefreshTokenDocument>,
  ) {}

  create(data: {
    user: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    userAgent?: string;
    ip?: string;
  }): Promise<RefreshTokenDocument> {
    return this.model.create({ ...data, user: new Types.ObjectId(data.user) });
  }

  findByHash(tokenHash: string): Promise<RefreshTokenDocument | null> {
    return this.model.findOne({ tokenHash }).exec();
  }

  async revokeById(id: Types.ObjectId): Promise<void> {
    await this.model.updateOne({ _id: id }, { revokedAt: new Date() }).exec();
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.model.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() }).exec();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.model
      .updateMany({ user: new Types.ObjectId(userId), revokedAt: null }, { revokedAt: new Date() })
      .exec();
  }
}
