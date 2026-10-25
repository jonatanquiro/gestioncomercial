import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { DbService } from '../../db/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  @HttpCode(200)
  async check() {
    try {
      await this.db.pool.query('SELECT 1');
      return { status: 'ok', db: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'unreachable' });
    }
  }
}
