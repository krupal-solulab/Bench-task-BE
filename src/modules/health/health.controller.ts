import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type Redis from 'ioredis';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { REDIS_CLIENT } from '../../redis/redis.constants';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  mongo: 'up' | 'down';
  redis: 'up' | 'down';
  version: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @RawResponse()
  @Get()
  @ApiOperation({ summary: 'Service health check' })
  @ApiResponse({ status: 200, description: 'All dependencies up' })
  @ApiResponse({ status: 503, description: 'One or more dependencies down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const mongoUp = this.mongoConnection.readyState === 1;
    const redisUp = await this.pingRedis();

    const body: HealthResponse = {
      status: mongoUp && redisUp ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mongo: mongoUp ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
      version: process.env.npm_package_version ?? '0.1.0',
    };

    res.status(body.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  private async pingRedis(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
