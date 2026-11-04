<?php

namespace Tests\Feature;

use Tests\TestCase;

/** Ingreso con nombre de usuario o email (ADR 0010). */
class UsernameTest extends TestCase
{
    private static function uniqueUsername(): string
    {
        return 'caja.'.bin2hex(random_bytes(6));
    }

    public function test_un_empleado_sin_email_ingresa_con_su_nombre_de_usuario(): void
    {
        $owner = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner['client'], 'cashier');
        $username = self::uniqueUsername();
        $res = $owner['client']->post('/employees', [
            'name' => 'Caja Uno', 'username' => '  '.strtoupper($username).' ', 'email' => '', 'password' => self::PASSWORD,
            'roleId' => $cashier['id'], 'branchIds' => $owner['me']['branchIds'],
        ]);
        $this->assertSame(201, $res->status, json_encode($res->body));

        $c = $this->client();
        $this->assertSame(200, $c->post('/auth/login', ['login' => strtoupper($username), 'password' => self::PASSWORD])->status);
        $me = $c->get('/auth/me')->body;
        $this->assertSame($username, $me['user']['username']);
        $this->assertNull($me['user']['email']);
        $this->assertSame('Cajero', $me['role']['name']);

        $row = collect($owner['client']->get('/employees')->body)->firstWhere('membershipId', $res->body['membershipId']);
        $this->assertSame($username, $row['username']);
        $this->assertNull($row['email']);
        $this->assertTrue($row['canSetPassword']);
    }

    public function test_el_alta_exige_usuario_o_email_y_rechaza_usuarios_repetidos_o_invalidos(): void
    {
        $owner = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner['client'], 'cashier');
        $base = ['name' => 'Caja', 'password' => self::PASSWORD, 'roleId' => $cashier['id'], 'branchIds' => $owner['me']['branchIds']];

        $none = $owner['client']->post('/employees', $base);
        $this->assertSame(400, $none->status);
        $this->assertSame('username', $none->body['details'][0]['path']);
        $this->assertSame('Indicá un nombre de usuario o un email', $none->body['details'][0]['message']);

        foreach (['ab', 'con@arroba', 'ñandú', '.punto'] as $bad) {
            $this->assertSame(400, $owner['client']->post('/employees', [...$base, 'username' => $bad])->status, $bad);
        }

        $username = self::uniqueUsername();
        $this->assertSame(201, $owner['client']->post('/employees', [...$base, 'username' => $username])->status);
        $other = $this->registerTenant();
        $otherCashier = $this->roleByTemplate($other['client'], 'cashier');
        $dup = $other['client']->post('/employees', [...$base, 'username' => $username, 'roleId' => $otherCashier['id'], 'branchIds' => $other['me']['branchIds']]);
        $this->assertSame(409, $dup->status);
        $this->assertSame('USERNAME_IN_USE', $dup->body['code']);
    }

    public function test_cada_persona_elige_su_usuario_y_sin_email_no_puede_quitarlo(): void
    {
        ['client' => $client, 'input' => $input] = $this->registerTenant();
        $username = self::uniqueUsername();
        $this->assertSame(200, $client->put('/auth/username', ['username' => $username])->status);
        $this->assertSame(200, $this->client()->post('/auth/login', ['login' => $username, 'password' => self::PASSWORD])->status);
        $this->assertSame(200, $this->client()->post('/auth/login', ['login' => $input['email'], 'password' => self::PASSWORD])->status);

        $other = $this->registerTenant();
        $taken = $other['client']->put('/auth/username', ['username' => $username]);
        $this->assertSame(409, $taken->status);

        $this->assertSame(200, $client->put('/auth/username', ['username' => null])->status);
        $this->assertSame(401, $this->client()->post('/auth/login', ['login' => $username, 'password' => self::PASSWORD])->status);

        $cashier = $this->roleByTemplate($client, 'cashier');
        $cajaName = self::uniqueUsername();
        $client->post('/employees', ['name' => 'Caja', 'username' => $cajaName, 'password' => self::PASSWORD, 'roleId' => $cashier['id'], 'branchIds' => $this->registerTenantBranches($client)]);
        $caja = $this->client();
        $caja->post('/auth/login', ['login' => $cajaName, 'password' => self::PASSWORD]);
        $this->assertSame(400, $caja->put('/auth/username', ['username' => ''])->status);
    }

    public function test_el_comercio_cambia_la_contrasena_de_quien_trabaja_solo_ahi(): void
    {
        $owner = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner['client'], 'cashier');
        $username = self::uniqueUsername();
        $created = $owner['client']->post('/employees', [
            'name' => 'Caja', 'username' => $username, 'password' => self::PASSWORD, 'roleId' => $cashier['id'], 'branchIds' => $owner['me']['branchIds'],
        ]);
        $caja = $this->client();
        $caja->post('/auth/login', ['login' => $username, 'password' => self::PASSWORD]);

        $newPassword = 'otra-clave-de-caja-7';
        $set = $owner['client']->put("/employees/{$created->body['membershipId']}/password", ['password' => $newPassword]);
        $this->assertSame(200, $set->status, json_encode($set->body));
        $this->assertSame(401, $caja->get('/auth/me')->status);
        $this->assertSame(401, $this->client()->post('/auth/login', ['login' => $username, 'password' => self::PASSWORD])->status);
        $this->assertSame(200, $this->client()->post('/auth/login', ['login' => $username, 'password' => $newPassword])->status);

        $audit = $owner['client']->get('/audit')->body;
        $this->assertContains('membership.password_set', array_column($audit['items'] ?? $audit, 'action'));

        $self = collect($owner['client']->get('/employees')->body)->firstWhere('userId', $owner['me']['user']['id']);
        $this->assertFalse($self['canSetPassword']);
        $this->assertSame(409, $owner['client']->put("/employees/{$self['membershipId']}/password", ['password' => $newPassword])->status);
    }

    public function test_no_cambia_la_contrasena_de_quien_tambien_trabaja_en_otro_comercio(): void
    {
        $a = $this->registerTenant();
        $b = $this->registerTenant();
        $cashierB = $this->roleByTemplate($b['client'], 'cashier');
        $add = $b['client']->post('/employees', [
            'name' => 'Ignorado', 'email' => $a['input']['email'], 'password' => 'otra-clave-que-no-se-usa',
            'roleId' => $cashierB['id'], 'branchIds' => $b['me']['branchIds'],
        ]);
        $row = collect($b['client']->get('/employees')->body)->firstWhere('membershipId', $add->body['membershipId']);
        $this->assertFalse($row['canSetPassword']);
        $res = $b['client']->put("/employees/{$add->body['membershipId']}/password", ['password' => 'clave-ajena-nueva-1']);
        $this->assertSame(409, $res->status);
        $this->assertSame('USER_IN_OTHER_TENANTS', $res->body['code']);
        $this->assertSame(200, $this->client()->post('/auth/login', ['login' => $a['input']['email'], 'password' => self::PASSWORD])->status);
    }

    /** @return list<string> */
    private function registerTenantBranches($client): array
    {
        return $client->get('/auth/me')->body['branchIds'];
    }
}
