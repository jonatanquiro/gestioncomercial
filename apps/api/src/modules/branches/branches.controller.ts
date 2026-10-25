import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { createBranchSchema, updateBranchSchema } from '@gc/contracts';
import type { TenantActor } from '../../common/actor';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list(@CurrentActor() actor: TenantActor) {
    return this.branches.list(actor);
  }

  @Post()
  @RequirePermission('branches.manage')
  create(
    @CurrentActor() actor: TenantActor,
    @Body(new ZodPipe(createBranchSchema)) body: { name: string; address: string | null },
  ) {
    return this.branches.create(actor, body);
  }

  @Put(':id')
  @RequirePermission('branches.manage')
  update(
    @CurrentActor() actor: TenantActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updateBranchSchema)) body: { name: string; address: string | null; status: 'active' | 'inactive' },
  ) {
    return this.branches.update(actor, id, body);
  }
}
