import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { type RoleInput, roleSchema } from '@gc/contracts';
import type { TenantActor } from '../../common/actor';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('roles.manage', 'users.manage')
  list(@CurrentActor() actor: TenantActor) {
    return this.roles.list(actor);
  }

  @Post()
  @RequirePermission('roles.manage')
  create(@CurrentActor() actor: TenantActor, @Body(new ZodPipe(roleSchema)) body: RoleInput) {
    return this.roles.create(actor, body);
  }

  @Put(':id')
  @RequirePermission('roles.manage')
  update(@CurrentActor() actor: TenantActor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(roleSchema)) body: RoleInput) {
    return this.roles.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('roles.manage')
  async remove(@CurrentActor() actor: TenantActor, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.roles.remove(actor, id);
    return { ok: true };
  }
}
