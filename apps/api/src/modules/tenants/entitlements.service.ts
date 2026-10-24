import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import type { Tx } from '../../db/db.service';
import { planFeatures, planLimits, plans, subscriptions, tenants } from '../../db/schema';

export interface TenantPlan {
  code: string;
  name: string;
  limits: Record<string, number>;
  features: string[];
}

/**
 * Único punto donde el núcleo pregunta por el plan. Los módulos comerciales no
 * conocen suscripciones ni cobros: solo consultan límites y funciones.
 */
@Injectable()
export class EntitlementsService {
  async plan(tx: Tx, tenantId: string): Promise<TenantPlan | null> {
    const [row] = await tx
      .select({ planId: plans.id, code: plans.code, name: plans.name })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.tenantId, tenantId), ne(subscriptions.status, 'cancelled')))
      .limit(1);
    if (!row) return null;
    const limits = await tx.select().from(planLimits).where(eq(planLimits.planId, row.planId));
    const features = await tx.select().from(planFeatures).where(eq(planFeatures.planId, row.planId));
    return {
      code: row.code,
      name: row.name,
      limits: Object.fromEntries(limits.map((l) => [l.key, l.value])),
      features: features.map((f) => f.feature),
    };
  }

  /**
   * Bloquea la fila del comercio hasta el fin de la transacción. Se llama antes de
   * contar recursos para que dos altas simultáneas no superen juntas el límite.
   */
  async lockTenant(tx: Tx, tenantId: string): Promise<void> {
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for('update');
  }

  /** Lanza PLAN_LIMIT_REACHED si crear un recurso más superaría el límite. */
  async assertBelowLimit(tx: Tx, tenantId: string, key: string, currentCount: number): Promise<void> {
    const plan = await this.plan(tx, tenantId);
    const limit = plan?.limits[key];
    if (limit === undefined) return;
    if (currentCount >= limit) throw Errors.planLimit(key, limit);
  }
}
