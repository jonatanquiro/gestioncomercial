import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import {
  type BusinessTypeDto,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerTenantSchema,
  resetPasswordSchema,
  switchTenantSchema,
} from '@gc/contracts';
import { asc } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '../../common/actor';
import { AllowNoTenant, ClientInfo, type ClientInfoValue, CurrentActor, Public, SkipCsrf } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService } from '../../db/db.service';
import { businessTypes } from '../../db/schema';
import { AuthService } from './auth.service';
import { clearSessionCookie, ensureCsrfCookie, issueCsrfCookie, SESSION_COOKIE, SESSION_MAX_MS, setSessionCookie } from './cookies';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DbService,
  ) {}

  @Public()
  @Get('business-types')
  async businessTypes(): Promise<BusinessTypeDto[]> {
    return this.db.auth((tx) =>
      tx.select({ code: businessTypes.code, name: businessTypes.name }).from(businessTypes).orderBy(asc(businessTypes.sortOrder)),
    );
  }

  @Public()
  @Post('auth/register')
  @HttpCode(201)
  async register(
    @Body(new ZodPipe(registerTenantSchema)) body: ReturnType<typeof registerTenantSchema.parse>,
    @ClientInfo() client: ClientInfoValue,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const session = await this.auth.register(body, client);
    setSessionCookie(reply, SESSION_COOKIE, session.token, SESSION_MAX_MS);
    issueCsrfCookie(reply);
    return { ok: true };
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @ClientInfo() client: ClientInfoValue,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const session = await this.auth.login(body.email, body.password, client);
    setSessionCookie(reply, SESSION_COOKIE, session.token, SESSION_MAX_MS);
    issueCsrfCookie(reply);
    return { ok: true };
  }

  @Public()
  @Post('auth/forgot-password')
  @HttpCode(202)
  async forgot(
    @Body(new ZodPipe(forgotPasswordSchema)) body: { email: string },
    @ClientInfo() client: ClientInfoValue,
  ) {
    await this.auth.forgotPassword(body.email, client);
    return { ok: true, message: 'Si el email está registrado, te enviamos un enlace para restablecer la contraseña.' };
  }

  @Public()
  @Post('auth/reset-password')
  @HttpCode(200)
  async reset(
    @Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string },
    @ClientInfo() client: ClientInfoValue,
  ) {
    await this.auth.resetPassword(body.token, body.password, client);
    return { ok: true };
  }

  @AllowNoTenant()
  @SkipCsrf()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(actor);
    clearSessionCookie(reply, SESSION_COOKIE);
    return { ok: true };
  }

  @AllowNoTenant()
  @Get('auth/me')
  async me(@CurrentActor() actor: Actor, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const me = await this.auth.me(actor);
    return { ...me, csrfToken: ensureCsrfCookie(req, reply) };
  }

  @AllowNoTenant()
  @Post('auth/switch-tenant')
  @HttpCode(200)
  async switchTenant(@CurrentActor() actor: Actor, @Body(new ZodPipe(switchTenantSchema)) body: { tenantId: string }) {
    await this.auth.switchTenant(actor, body.tenantId);
    return { ok: true };
  }

  @AllowNoTenant()
  @Post('auth/change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
  ) {
    await this.auth.changePassword(actor, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @AllowNoTenant()
  @Get('auth/sessions')
  sessions(@CurrentActor() actor: Actor) {
    return this.auth.listSessions(actor);
  }

  @AllowNoTenant()
  @Delete('auth/sessions/:id')
  @HttpCode(200)
  async revokeSession(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.auth.revokeSession(actor, id);
    return { ok: true };
  }
}
