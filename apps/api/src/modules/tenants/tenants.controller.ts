import { Body, Controller, Get, Put } from '@nestjs/common';
import { type UpdateTenantInput, updateTenantSchema } from '@gc/contracts';
import type { TenantActor } from '../../common/actor';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { TenantsService } from './tenants.service';

@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  get(@CurrentActor() actor: TenantActor) {
    return this.tenants.get(actor);
  }

  @Put()
  @RequirePermission('settings.manage')
  update(@CurrentActor() actor: TenantActor, @Body(new ZodPipe(updateTenantSchema)) body: UpdateTenantInput) {
    return this.tenants.update(actor, body);
  }
}
