import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  MONGO_URI: Joi.string().uri().required(),
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
})
  .or('REDIS_URL', 'REDIS_HOST')
  .messages({
    'object.missing': 'Set either REDIS_URL or REDIS_HOST (+ REDIS_PORT) to configure Redis',
  });
