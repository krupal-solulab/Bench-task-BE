import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  // Not Joi.string().uri(): a non-SRV Atlas connection string legitimately lists
  // multiple comma-separated host:port pairs in the authority component, which
  // generic URI syntax (and so Joi's uri() check) rejects even though the mongodb
  // driver accepts it fine. Just check the scheme instead.
  MONGO_URI: Joi.string()
    .pattern(/^mongodb(\+srv)?:\/\/.+/)
    .required(),
  MONGO_DB_NAME: Joi.string().required(),

  // Either REDIS_URL (a single connection string, as given by managed providers
  // like Upstash/Render/Railway - supports rediss:// for TLS) or REDIS_HOST +
  // REDIS_PORT (used for local/Docker Compose Redis) must be provided.
  REDIS_URL: Joi.string().uri().optional(),
  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().port().optional(),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_TTL_DASHBOARD: Joi.number().positive().default(60),
  REDIS_TTL_TREND: Joi.number().positive().default(300),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  BCRYPT_SALT_ROUNDS: Joi.number().min(4).max(15).default(12),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  THROTTLE_TTL: Joi.number().positive().default(60),
  THROTTLE_LIMIT: Joi.number().positive().default(100),
  AUTH_THROTTLE_LIMIT: Joi.number().positive().default(5),

  SWAGGER_ENABLED: Joi.boolean().default(true),

  SEED_ADMIN_EMAIL: Joi.string().email().required(),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).required(),

  // Bootstraps the first PlatformAdmin account (multi-tenancy retrofit) via the migration/seed
  // scripts. Required in every environment, mirroring SEED_ADMIN_* above.
  PLATFORM_ADMIN_EMAIL: Joi.string().email().required(),
  PLATFORM_ADMIN_PASSWORD: Joi.string().min(8).required(),

  // S3-compatible object storage for task attachments (points at a local MinIO container
  // for dev - see docker-compose.yml - or a real S3-compatible bucket in production).
  S3_ENDPOINT: Joi.string().uri().required(),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_BUCKET: Joi.string().required(),
  S3_REGION: Joi.string().default('us-east-1'),
})
  .or('REDIS_URL', 'REDIS_HOST')
  .messages({
    'object.missing': 'Set either REDIS_URL or REDIS_HOST (+ REDIS_PORT) to configure Redis',
  });
