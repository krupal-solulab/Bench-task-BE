export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  mongo: {
    uri: string;
    dbName: string;
  };
  redis: {
    url?: string;
    host: string;
    port: number;
    password?: string;
    ttlDashboard: number;
    ttlTrend: number;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  bcryptSaltRounds: number;
  logLevel: string;
  throttle: {
    ttl: number;
    limit: number;
    authLimit: number;
  };
  swaggerEnabled: boolean;
  seedAdmin: {
    email: string;
    password: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  mongo: {
    uri: process.env.MONGO_URI ?? '',
    dbName: process.env.MONGO_DB_NAME ?? '',
  },
  redis: {
    url: process.env.REDIS_URL || undefined,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    ttlDashboard: parseInt(process.env.REDIS_TTL_DASHBOARD ?? '60', 10),
    ttlTrend: parseInt(process.env.REDIS_TTL_TREND ?? '300', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    authLimit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '5', 10),
  },
  swaggerEnabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL ?? '',
    password: process.env.SEED_ADMIN_PASSWORD ?? '',
  },
});
