import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { DashboardService } from 'src/modules/dashboard/dashboard.service';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { CacheService } from 'src/redis/cache.service';

const ORG_A = '507f1f77bcf86cd799439099';
const USER_ID = '507f1f77bcf86cd799439001';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ID,
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: ORG_A,
    ...overrides,
  };
}

describe('DashboardService.getPreferences / updatePreferences', () => {
  let dashboardPreferenceModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let service: DashboardService;

  beforeEach(() => {
    dashboardPreferenceModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    // These four dependencies are untouched by the preferences methods under test - minimal
    // stand-ins are enough since nothing here calls them.
    const projectsService = {} as ProjectsService;
    const cacheService = {} as CacheService;
    const configService = { get: jest.fn() } as never;
    const unusedModel = {} as never;

    service = new DashboardService(
      projectsService,
      cacheService,
      configService,
      unusedModel,
      unusedModel,
      unusedModel,
      dashboardPreferenceModel as never,
    );
  });

  describe('getPreferences', () => {
    it("returns empty defaults (today's behavior) when the user has no saved preference", async () => {
      const result = await service.getPreferences(makeUser());
      expect(result).toEqual({ hiddenWidgets: [], widgetOrder: [] });
    });

    it("returns the caller's saved preference when one exists", async () => {
      dashboardPreferenceModel.findOne.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ hiddenWidgets: ['overdueList'], widgetOrder: ['tasksStatus'] }),
      });
      const result = await service.getPreferences(makeUser());
      expect(result).toEqual({ hiddenWidgets: ['overdueList'], widgetOrder: ['tasksStatus'] });
    });
  });

  describe('updatePreferences', () => {
    it('upserts the preference scoped to the caller', async () => {
      dashboardPreferenceModel.findOneAndUpdate.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ hiddenWidgets: ['taskTrend'], widgetOrder: ['tasksStatus'] }),
      });

      const result = await service.updatePreferences(
        { hiddenWidgets: ['taskTrend'], widgetOrder: ['tasksStatus'] },
        makeUser(),
      );

      expect(dashboardPreferenceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ owner: expect.anything() }),
        expect.objectContaining({ hiddenWidgets: ['taskTrend'], widgetOrder: ['tasksStatus'] }),
        { upsert: true, new: true },
      );
      expect(result).toEqual({ hiddenWidgets: ['taskTrend'], widgetOrder: ['tasksStatus'] });
    });
  });
});
