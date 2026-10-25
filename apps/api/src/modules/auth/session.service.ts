import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashToken, randomToken } from '../../common/crypto';
import { uuidv7 } from '../../common/ids';
import type { Tx } from '../../db/db.service';
import { DbService } from '../../db/db.service';
import { sessions, users } from '../../db/schema';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from './cookies';

export interface ValidSession {
  sessionId: string;
  tenantId: string | null;
  userId: string;
  userName: string;
  userEmail: string;
}

/** Sesiones de usuarios de comercios. Todas las operaciones corren con el rol gc_auth. */
@Injectable()
export class SessionService {
  constructor(private readonly db: DbService) {}

  async create(tx: Tx, input: { userId: string; tenantId: string | null; ip: string; userAgent: string | null }) {
    const token = randomToken();
    const id = uuidv7();
    await tx.insert(sessions).values({
      id,
      userId: input.userId,
      tenantId: input.tenantId,
      tokenHash: hashToken(token),
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + SESSION_MAX_MS),
    });
    return { id, token };
  }

  async validate(token: string): Promise<ValidSession | null> {
    return this.db.auth(async (tx) => {
      const [row] = await tx
        .select({
          sessionId: sessions.id,
          tenantId: sessions.tenantId,
          lastSeenAt: sessions.lastSeenAt,
          userId: users.id,
          userName: users.name,
          userEmail: users.email,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, hashToken(token)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, sql`now()`),
            gt(sessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_MS)),
            eq(users.status, 'active'),
          ),
        )
        .limit(1);
      if (!row) return null;
      if (Date.now() - row.lastSeenAt.getTime() > 5 * 60 * 1000) {
        await tx.update(sessions).set({ lastSeenAt: sql`now()` }).where(eq(sessions.id, row.sessionId));
      }
      return {
        sessionId: row.sessionId,
        tenantId: row.tenantId,
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
      };
    });
  }

  async setTenant(tx: Tx, sessionId: string, tenantId: string | null) {
    await tx.update(sessions).set({ tenantId }).where(eq(sessions.id, sessionId));
  }

  async revoke(tx: Tx, sessionId: string, userId: string) {
    const result = await tx
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return result.length > 0;
  }

  async revokeAll(tx: Tx, userId: string, exceptSessionId?: string) {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) conditions.push(sql`${sessions.id} <> ${exceptSessionId}`);
    await tx.update(sessions).set({ revokedAt: sql`now()` }).where(and(...conditions));
  }

  async listActive(tx: Tx, userId: string) {
    return tx
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          gt(sessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_MS)),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
  }
}
