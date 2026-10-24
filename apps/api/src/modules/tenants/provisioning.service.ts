import { Injectable } from '@nestjs/common';
import { ROLE_TEMPLATES, type RegisterTenantInput, type TenantSettings } from '@gc/contracts';
import { asc, eq } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import type { Tx } from '../../db/db.service';
import {
  branches,
  businessTypes,
  membershipBranches,
  memberships,
  plans,
  rolePermissions,
  roles,
  subscriptions,
  tenants,
  warehouses,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

export const DEFAULT_PLAN_CODE = 'inicial';

/**
 * Alta de un comercio con todo lo necesario para operar: suscripción de prueba,
 * sucursal y depósito por defecto, roles plantilla y membresía del propietario.
 * Debe correr dentro de una transacción con contexto gc_tenant del comercio nuevo.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(private readonly audit: AuditService) {}

  async create(
    tx: Tx,
    params: { tenantId: string; ownerUserId: string; ownerName: string; input: RegisterTenantInput; ip: string; requestId: string },
  ) {
    const { tenantId, ownerUserId, input } = params;
    const [bt] = await tx.select().from(businessTypes).where(eq(businessTypes.code, input.businessTypeCode)).limit(1);
    if (!bt) throw Errors.validation([{ path: 'businessTypeCode', message: 'Rubro inexistente' }]);
    const defaults = bt.defaultSettings as { allowNegativeStock: boolean; priceRoundingStep: number };
    const settings: TenantSettings = {
      allowNegativeStock: defaults.allowNegativeStock,
      priceRoundingStep: defaults.priceRoundingStep as TenantSettings['priceRoundingStep'],
    };

    const [plan] = await tx.select().from(plans).where(eq(plans.code, DEFAULT_PLAN_CODE)).orderBy(asc(plans.sortOrder)).limit(1);
    if (!plan) throw new Error(`No existe el plan ${DEFAULT_PLAN_CODE}; corré las migraciones`);

    await tx.insert(tenants).values({
      id: tenantId,
      tradeName: input.tradeName,
      legalName: input.legalName ?? null,
      cuit: input.cuit ?? null,
      taxCondition: input.taxCondition,
      businessTypeCode: bt.code,
      status: 'trial',
      settings,
    });

    await tx.insert(subscriptions).values({
      id: uuidv7(),
      tenantId,
      planId: plan.id,
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000),
    });

    const branchId = uuidv7();
    await tx.insert(branches).values({ id: branchId, tenantId, name: 'Casa central' });
    await tx.insert(warehouses).values({ id: uuidv7(), tenantId, branchId, name: 'Depósito principal', isDefault: true });

    let ownerRoleId = '';
    for (const template of ROLE_TEMPLATES) {
      const roleId = uuidv7();
      if (template.code === 'owner') ownerRoleId = roleId;
      await tx.insert(roles).values({
        id: roleId,
        tenantId,
        name: template.name,
        isSystem: template.code === 'owner',
        templateCode: template.code,
      });
      if (template.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(template.permissions.map((permissionCode) => ({ tenantId, roleId, permissionCode })));
      }
    }

    const membershipId = uuidv7();
    await tx.insert(memberships).values({ id: membershipId, tenantId, userId: ownerUserId, roleId: ownerRoleId });
    await tx.insert(membershipBranches).values({ tenantId, membershipId, branchId });

    await this.audit.record(tx, {
      tenantId,
      actorType: 'user',
      actorId: ownerUserId,
      actorName: params.ownerName,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenantId,
      after: { tradeName: input.tradeName, businessType: bt.code, plan: plan.code },
      ip: params.ip,
      requestId: params.requestId,
    });
    return { tenantId, branchId, membershipId };
  }
}
