import { PinoLogger } from 'nestjs-pino';
import { ProjectBackupsTriggerService } from 'src/modules/import-export/project-backups-trigger.service';
import { ProjectsRepository } from 'src/modules/projects/projects.repository';
import { ImportExportService } from 'src/modules/import-export/import-export.service';

function makeLogger(): PinoLogger {
  return { debug: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;
}

describe('ProjectBackupsTriggerService', () => {
  let projectsRepository: jest.Mocked<Pick<ProjectsRepository, 'findAllActive'>>;
  let importExportService: jest.Mocked<Pick<ImportExportService, 'snapshotProjectForCron'>>;
  let service: ProjectBackupsTriggerService;

  beforeEach(() => {
    projectsRepository = { findAllActive: jest.fn() };
    importExportService = { snapshotProjectForCron: jest.fn().mockResolvedValue(undefined) };
    service = new ProjectBackupsTriggerService(
      projectsRepository as unknown as ProjectsRepository,
      importExportService as unknown as ImportExportService,
      makeLogger(),
    );
  });

  it('snapshots every active project returned by the repository', async () => {
    projectsRepository.findAllActive.mockResolvedValue([
      { id: 'p-1' } as never,
      { id: 'p-2' } as never,
    ]);

    await service.handleDailyBackups();

    expect(importExportService.snapshotProjectForCron).toHaveBeenCalledTimes(2);
    expect(importExportService.snapshotProjectForCron).toHaveBeenCalledWith({ id: 'p-1' });
    expect(importExportService.snapshotProjectForCron).toHaveBeenCalledWith({ id: 'p-2' });
  });

  it('does nothing when there are no active projects', async () => {
    projectsRepository.findAllActive.mockResolvedValue([]);

    await service.handleDailyBackups();

    expect(importExportService.snapshotProjectForCron).not.toHaveBeenCalled();
  });

  it("continues to the next project when one project's snapshot fails", async () => {
    projectsRepository.findAllActive.mockResolvedValue([
      { id: 'p-1' } as never,
      { id: 'p-2' } as never,
    ]);
    importExportService.snapshotProjectForCron
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce(undefined);

    await expect(service.handleDailyBackups()).resolves.toBeUndefined();

    expect(importExportService.snapshotProjectForCron).toHaveBeenCalledTimes(2);
  });
});
