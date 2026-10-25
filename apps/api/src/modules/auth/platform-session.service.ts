import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashToken, randomToken } from '../../common/crypto';
import { uuidv7 } from '../../common/ids';
import { DbService, type Tx } from '../../db/db.service';
import { platformSessions, platformUsers } from '../../db/schema';
import { PLATFORM_IDLE_MS, PLATFORM_MAX_MS } from './cookies';

/** Sesiones del panel de plataforma: más cortas y separadas de las de comercios. */
@Injectable()
export class PlatformSessionService {
  constructor(private readonly db: DbService) {}

  async create(tx: Tx, input: { platformUserId: string; ip: string; userAgent: string | null }) {
    const token = randomToken();
    await tx.insert(platformSessions).values({
      id: uuidv7(),
      platformUserId: input.platformUserId,
      tokenHash: hashToken(token),
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + PLATFORM_MAX_MS),
    });
    return token;
  }

  async validate(token: string) {
    return this.db.platform(async (tx) => {
      const [row] = await tx
        .select({ sessionId: platformSessions.id, platformUserId: platformUsers.id, name: platformUsers.name })
        .from(platformSessions)
        .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.platformUserId))
        .where(
          and(
            eq(platformSessions.tokenHash, hashToken(token)),
            isNull(platformSessions.revokedAt),
            gt(platformSessions.expiresAt, sql`now()`),
            gt(platformSessions.lastSeenAt, new Date(Date.now() - PLATFORM_IDLE_MS)),
            eq(platformUsers.status, 'active'),
          ),
        )
        .limit(1);
      if (!row) return null;
      await tx.update(platformSessions).set({ lastSeenAt: sql`now()` }).where(eq(platformSessions.id, row.sessionId));
      return row;
    });
  }

  async revoke(tx: Tx, sessionId: string) {
    await tx.update(platformSessions).set({ revokedAt: sql`now()` }).where(eq(platformSessions.id, sessionId));
  }
}
