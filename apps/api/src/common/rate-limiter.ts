import { Injectable } from '@nestjs/common';
import { Errors } from './errors';

/**
 * Limitador en memoria por ventana fija. Suficiente para una sola instancia de la
 * API (monolito). Si se escala horizontalmente, mover a PostgreSQL o Redis.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  consume(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return;
    }
    entry.count += 1;
    if (entry.count > limit) throw Errors.tooManyRequests();
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  clear(): void {
    this.hits.clear();
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
