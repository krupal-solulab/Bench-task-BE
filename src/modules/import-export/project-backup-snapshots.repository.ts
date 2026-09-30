import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProjectBackupSnapshot,
  ProjectBackupSnapshotDocument,
} from './schemas/project-backup-snapshot.schema';

@Injectable()
export class ProjectBackupSnapshotsRepository {
  constructor(
    @InjectModel(ProjectBackupSnapshot.name)
    private readonly model: Model<ProjectBackupSnapshotDocument>,
  ) {}

  create(data: Partial<ProjectBackupSnapshot>): Promise<ProjectBackupSnapshotDocument> {
    return this.model.create(data);
  }

  /** Newest first - metadata only (the `backup` field is intentionally excluded via projection,
   * since a single snapshot's content can be large and the list view only needs to show when each
   * one was taken). */
  listForProject(
    projectId: string,
    organizationId: string,
  ): Promise<ProjectBackupSnapshotDocument[]> {
    return this.model
      .find(
        {
          project: new Types.ObjectId(projectId),
          organizationId: new Types.ObjectId(organizationId),
        },
        { backup: 0 },
      )
      .sort({ createdAt: -1 })
      .exec();
  }

  findByIdForProject(
    id: string,
    projectId: string,
    organizationId: string,
  ): Promise<ProjectBackupSnapshotDocument | null> {
    return this.model
      .findOne({
        _id: id,
        project: new Types.ObjectId(projectId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }
}
