import { Global, Module } from '@nestjs/common';
import { RateLimiter } from '../../common/rate-limiter';
import { AuditService } from '../audit/audit.service';
import { TenantProvisioningService } from '../tenants/provisioning.service';
import { ActorService } from './actor.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PlatformSessionService } from './platform-session.service';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    PlatformSessionService,
    ActorService,
    PasswordService,
    AuthGuard,
    RateLimiter,
    AuditService,
    TenantProvisioningService,
  ],
  exports: [SessionService, PlatformSessionService, ActorService, PasswordService, AuthGuard, RateLimiter, AuditService],
})
export class AuthModule {}
