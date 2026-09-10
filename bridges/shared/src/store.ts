import { Redis } from 'ioredis';
import type { BridgeChannel } from './types.js';

/**
 * Maps external chat IDs to Zammad ticket IDs.
 * Per-chat Redis lock prevents concurrent double-ticket creation.
 */
export class SessionStore {
  private readonly redis: Redis;

  constructor(redisUrl: string, private readonly channel: BridgeChannel) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  private chatKey(externalId: string): string {
    return `bridge:${this.channel}:chat:${externalId}`;
  }

  private ticketKey(ticketId: number): string {
    return `bridge:${this.channel}:ticket:${ticketId}`;
  }

  private lockKey(externalId: string): string {
    return `bridge:${this.channel}:lock:${externalId}`;
  }

  async getTicketId(externalChatId: string): Promise<number | null> {
    const value = await this.redis.get(this.chatKey(externalChatId));
    if (!value) return null;
    const id = Number(value);
    return Number.isFinite(id) ? id : null;
  }

  async getExternalId(ticketId: number): Promise<string | null> {
    return this.redis.get(this.ticketKey(ticketId));
  }

  async bind(externalChatId: string, ticketId: number): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.set(this.chatKey(externalChatId), String(ticketId));
    pipeline.set(this.ticketKey(ticketId), externalChatId);
    await pipeline.exec();
  }

  /** Drop chat↔ticket mapping (after /end). */
  async unbind(externalChatId: string): Promise<number | null> {
    const ticketId = await this.getTicketId(externalChatId);
    const pipeline = this.redis.pipeline();
    pipeline.del(this.chatKey(externalChatId));
    if (ticketId) {
      pipeline.del(this.ticketKey(ticketId));
    }
    await pipeline.exec();
    return ticketId;
  }

  /**
   * Acquire a short-lived lock for a chat. Caller must release in finally.
   */
  async withChatLock<T>(externalChatId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.lockKey(externalChatId);
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ttlMs = 30_000;
    const deadline = Date.now() + ttlMs;

    while (Date.now() < deadline) {
      const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
      if (ok === 'OK') {
        try {
          return await fn();
        } finally {
          const current = await this.redis.get(key);
          if (current === token) {
            await this.redis.del(key);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 50)));
    }

    throw new Error(`Could not acquire lock for chat ${externalChatId}`);
  }

  async ping(): Promise<string> {
    return this.redis.ping();
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
