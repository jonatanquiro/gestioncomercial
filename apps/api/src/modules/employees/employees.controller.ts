import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { type CreateEmployeeInput, createEmployeeSchema, type UpdateMembershipInput, updateMembershipSchema } from '@gc/contracts';
import type { TenantActor } from '../../common/actor';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { EmployeesService } from './employees.service';

@Controller('employees')
@RequirePermission('users.manage')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentActor() actor: TenantActor) {
    return this.employees.list(actor);
  }

  @Post()
  create(@CurrentActor() actor: TenantActor, @Body(new ZodPipe(createEmployeeSchema)) body: CreateEmployeeInput) {
    return this.employees.create(actor, body);
  }

  @Put(':membershipId')
  update(
    @CurrentActor() actor: TenantActor,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body(new ZodPipe(updateMembershipSchema)) body: UpdateMembershipInput,
  ) {
    return this.employees.update(actor, membershipId, body);
  }
}
