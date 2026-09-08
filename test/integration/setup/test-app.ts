import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Model, Types } from 'mongoose';
import { AppModule } from 'src/app.module';
import { AppConfig } from 'src/config/configuration';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { Role } from 'src/common/enums/role.enum';
import { OrganizationStatus } from 'src/common/enums/organization-status.enum';
import { User, UserDocument } from 'src/modules/users/schemas/user.schema';
import {
  Organization,
  OrganizationDocument,
} from 'src/modules/organizations/schemas/organization.schema';
import {
  startInMemoryMongo,
  stopInMemoryMongo,
  clearInMemoryMongo,
} from '../../setup/mongo-memory.setup';
import { FakeRedis } from './fake-redis';

export const API_PREFIX = 'api/v1';

export interface TestAppContext {
  app: INestApplication;
  httpServer: ReturnType<INestApplication['getHttpServer']>;
  fakeRedis: FakeRedis;
}

/**
 * Boots a full Nest application (the real AppModule) against an in-memory Mongo and a fake,
 * in-process Redis stand-in, with rate limiting disabled. Every env var the Joi schema in
 * src/config/env.validation.ts requires is set here, before the testing module is compiled -
 * ConfigModule reads process.env at module-init time, not at import time, so this ordering
 * (env vars set -> THEN Test.createTestingModule(...).compile()) is what matters, not import
 * order of this file itself.
 */
export async function createTestApp(): Promise<TestAppContext> {
  const mongoUri = await startInMemoryMongo();

  process.env.NODE_ENV = 'test';
  process.env.API_PREFIX = API_PREFIX;
  process.env.MONGO_URI = mongoUri;
  process.env.MONGO_DB_NAME = 'bench_integration_test';
  // Required by the `.or('REDIS_URL', 'REDIS_HOST')` Joi check even though the REDIS_CLIENT
  // provider is overridden below and no real Redis connection is ever opened.
  delete process.env.REDIS_URL;
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';
  process.env.REDIS_TTL_DASHBOARD = '60';
  process.env.REDIS_TTL_TREND = '300';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.BCRYPT_SALT_ROUNDS = '4';
  process.env.LOG_LEVEL = 'silent';
  process.env.THROTTLE_TTL = '60';
  process.env.THROTTLE_LIMIT = '100000';
  process.env.AUTH_THROTTLE_LIMIT = '100000';
  process.env.SWAGGER_ENABLED = 'false';
  process.env.SEED_ADMIN_EMAIL = 'seed-admin@example.com';
  process.env.SEED_ADMIN_PASSWORD = 'SeedAdmin123';
  process.env.PLATFORM_ADMIN_EMAIL = 'platform-admin@example.com';
  process.env.PLATFORM_ADMIN_PASSWORD = 'PlatformAdmin123';

  const fakeRedis = new FakeRedis();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(REDIS_CLIENT)
    .useValue(fakeRedis)
    // `ThrottlerGuard` is registered as `{ provide: APP_GUARD, useClass: ThrottlerGuard }` in
    // AppModule. Nest's enhancer-token indirection for APP_GUARD/APP_INTERCEPTOR/etc. means the
    // class is never registered under its own `ThrottlerGuard` token, so `.overrideGuard
    // (ThrottlerGuard)` is silently a no-op here (confirmed empirically: login/register still hit
    // the hardcoded `@Throttle({ limit: 5, ttl: 60_000 })` and 429'd after a handful of calls).
    // `ThrottlerStorage` (the counter store the guard reads from) IS a normal, directly-registered
    // provider, so overriding it to report "never blocked" disables rate limiting for every route,
    // regardless of the route-level/global limit configured.
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: async () => ({
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  const configService = app.get(ConfigService<AppConfig, true>);
  app.setGlobalPrefix(configService.get('apiPrefix', { infer: true }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  return { app, httpServer: app.getHttpServer(), fakeRedis };
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
  await stopInMemoryMongo();
}

export { clearInMemoryMongo };

export interface SeedUserOptions {
  name?: string;
  email: string;
  password: string;
  role: Role;
  /** Required for every role except PlatformAdmin, who must pass null explicitly. */
  organizationId: string | null;
  isActive?: boolean;
}

/**
 * Inserts a user directly via the Mongoose model with a pre-hashed password, bypassing the
 * admin-provisioning API so specs can cheaply get Admin/Manager/Developer/PlatformAdmin fixtures
 * in any organization. The real login flow (POST /auth/login) is still used afterwards to obtain
 * a genuine token.
 */
export async function seedUser(
  app: INestApplication,
  options: SeedUserOptions,
): Promise<UserDocument> {
  const model = app.get<Model<UserDocument>>(getModelToken(User.name));
  const passwordHash = await bcrypt.hash(options.password, 4);
  return model.create({
    name: options.name ?? 'Test User',
    email: options.email.toLowerCase(),
    passwordHash,
    role: options.role,
    // Cast explicitly to an ObjectId rather than relying on Mongoose's implicit-cast-on-save:
    // the real create paths (UsersService.create / OrganizationsService.createWithAdmin) always
    // pass an already-constructed ObjectId, so this keeps directly-seeded fixtures identical to
    // what production code writes (important for org-scoped queries that filter by an exact
    // ObjectId value against this field).
    organizationId: options.organizationId ? new Types.ObjectId(options.organizationId) : null,
    isActive: options.isActive ?? true,
  });
}

/** Inserts an Organization directly via the Mongoose model. */
export async function seedOrganization(
  app: INestApplication,
  options: { name?: string; slug?: string; status?: OrganizationStatus } = {},
): Promise<OrganizationDocument> {
  const model = app.get<Model<OrganizationDocument>>(getModelToken(Organization.name));
  const unique = Math.random().toString(36).slice(2, 10);
  return model.create({
    name: options.name ?? `Test Org ${unique}`,
    slug: options.slug ?? `test-org-${unique}`,
    status: options.status ?? OrganizationStatus.ACTIVE,
  });
}

export interface AuthTokensAndUser {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

export async function loginAs(
  app: INestApplication,
  email: string,
  password: string,
): Promise<AuthTokensAndUser> {
  const res = await request(app.getHttpServer())
    .post(`/${API_PREFIX}/auth/login`)
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as AuthTokensAndUser;
}

/** Seeds a user with the given role and logs them in through the real auth flow. */
export async function seedUserAndLogin(
  app: INestApplication,
  options: SeedUserOptions,
): Promise<AuthTokensAndUser & { userDoc: UserDocument }> {
  const userDoc = await seedUser(app, options);
  const tokens = await loginAs(app, options.email, options.password);
  return { ...tokens, userDoc };
}

/**
 * Registers a brand-new organization (and its first Admin) through the public endpoint and logs
 * in via the token issued at registration.
 */
export async function registerOrganizationAndLogin(
  app: INestApplication,
  options: {
    organizationName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  },
): Promise<AuthTokensAndUser> {
  const res = await request(app.getHttpServer())
    .post(`/${API_PREFIX}/auth/register-organization`)
    .send(options);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `register-organization failed for ${options.adminEmail}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data as AuthTokensAndUser;
}

export function authHeader(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
