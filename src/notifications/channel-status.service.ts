import { Injectable } from '@nestjs/common';
import { CacheService } from '../redis/cache.service';

/** The only two notification channels a Platform Admin can meaningfully pause (BRD 8) - Mongo/
 * Redis/S3 aren't "pausable" without breaking the app, and stay display-only on the Integration
 * Health page. */
export const PAUSABLE_NOTIFICATION_CHANNELS = ['Email', 'WhatsApp'] as const;
export type PausableNotificationChannel = (typeof PAUSABLE_NOTIFICATION_CHANNELS)[number];

/**
 * A Platform Admin's Email/WhatsApp pause switch, backed by a durable Redis flag (never expires,
 * unlike CacheService's other TTL-bounded uses) so a pause survives restarts. Checked by
 * NotificationsService before actually sending on that channel; read (and toggled) by the
 * Integration Health page.
 */
@Injectable()
export class ChannelStatusService {
  constructor(private readonly cacheService: CacheService) {}

  async isPaused(channel: PausableNotificationChannel): Promise<boolean> {
    return (await this.cacheService.get<boolean>(this.key(channel))) === true;
  }

  async setPaused(channel: PausableNotificationChannel, paused: boolean): Promise<void> {
    await this.cacheService.setPersistent(this.key(channel), paused);
  }

  private key(channel: PausableNotificationChannel): string {
    return `notification-channel-paused:${channel}`;
  }
}
