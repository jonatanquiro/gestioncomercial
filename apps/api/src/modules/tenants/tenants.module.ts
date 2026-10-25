import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Global()
@Module({
  controllers: [TenantsController],
  providers: [TenantsService, EntitlementsService],
  exports: [EntitlementsService],
})
export class TenantsModule {}
