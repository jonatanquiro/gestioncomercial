<?php

namespace Tests\Feature;

use App\Models\AuditEntry;
use App\Models\PlatformUser;
use App\Services\PasswordService;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Actualizar la base desde el panel de plataforma (ADR 0026), para hostings sin consola. */
class PlatformDatabaseTest extends TestCase
{
    private const MIGRATION = '2026_11_12_000001_variantes_en_todos_los_planes';

    private function admin(): ApiClient
    {
        PlatformUser::create(['email' => $email = self::uniqueEmail('admin'), 'name' => 'Admin', 'password_hash' => app(PasswordService::class)->hash('Plataforma-Segura-2026')]);
        $c = $this->client();
        $this->assertSame(200, $c->post('/platform/auth/login', ['email' => $email, 'password' => 'Plataforma-Segura-2026'])->status);

        return $c;
    }

    public function test_muestra_lo_pendiente_y_lo_aplica(): void
    {
        $admin = $this->admin();
        $state = $admin->get('/platform/database')->body;
        $this->assertTrue($state['supported']);
        $this->assertSame([], $state['pending']);
        $this->assertMatchesRegularExpression('/^(MariaDB|MySQL) \d+\.\d+/', $state['server']);

        // Una migración idempotente queda como pendiente, como en un hosting que recibió archivos nuevos.
        DB::table('migrations')->where('migration', self::MIGRATION)->delete();
        $this->assertSame([self::MIGRATION], $admin->get('/platform/database')->body['pending']);
        $this->assertSame('confirm', $admin->post('/platform/database/migrate', ['confirm' => false])->body['details'][0]['path']);

        $done = $admin->post('/platform/database/migrate', ['confirm' => true]);
        $this->assertSame(200, $done->status, json_encode($done->body));
        $this->assertSame([[self::MIGRATION], []], [$done->body['ran'], $done->body['pending']]);
        $this->assertTrue(AuditEntry::withoutGlobalScopes()->where('action', 'platform.database_migrated')->exists());
        $this->assertSame([], $admin->post('/platform/database/migrate', ['confirm' => true])->body['ran']);
    }

    public function test_solo_la_plataforma(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $this->assertSame(401, $owner->get('/platform/database')->status);
        $this->assertSame(401, $owner->post('/platform/database/migrate', ['confirm' => true])->status);
    }
}
