import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { listQuerySchema, platformLoginSchema, setTenantStatusSchema, type UpdatePlanInput, updatePlanSchema } from '@gc/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PlatformActor } from '../../common/actor';
import { ClientInfo, type ClientInfoValue, CurrentPlatformActor, PlatformRoute, Public } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { clearSessionCookie, ensureCsrfCookie, issueCsrfCookie, PLATFORM_MAX_MS, PLATFORM_SESSION_COOKIE, setSessionCookie } from '../auth/cookies';
import { PlatformService } from './platform.service';

const tenantsQuery = listQuerySchema.extend({
  status: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']).optional(),
});

@Controller('platform')
@PlatformRoute()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(platformLoginSchema)) body: z.infer<typeof platformLoginSchema>,
    @ClientInfo() client: ClientInfoValue,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = await this.platform.login(body, client);
    setSessionCookie(reply, PLATFORM_SESSION_COOKIE, token, PLATFORM_MAX_MS);
    issueCsrfCookie(reply);
    return { ok: true };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@CurrentPlatformActor() actor: PlatformActor, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.platform.logout(actor);
    clearSessionCookie(reply, PLATFORM_SESSION_COOKIE);
    return { ok: true };
  }

  @Get('auth/me')
  me(@CurrentPlatformActor() actor: PlatformActor, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return { id: actor.platformUserId, name: actor.name, csrfToken: ensureCsrfCookie(req, reply) };
  }

  @Get('tenants')
  tenants(@Query(new ZodPipe(tenantsQuery)) q: z.infer<typeof tenantsQuery>) {
    return this.platform.listTenants(q);
  }

  @Post('tenants/:id/status')
  @HttpCode(200)
  setStatus(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(setTenantStatusSchema)) body: z.infer<typeof setTenantStatusSchema>,
  ) {
    return this.platform.setTenantStatus(actor, id, body);
  }

  @Get('plans')
  plans() {
    return this.platform.listPlans();
  }

  @Put('plans/:id')
  updatePlan(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updatePlanSchema)) body: UpdatePlanInput,
  ) {
    return this.platform.updatePlan(actor, id, body);
  }

  @Get('audit')
  audit(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.platform.listAudit(q);
  }
}
