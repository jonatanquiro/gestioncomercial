<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Emitir facturas sin administrar certificados. Los roles existentes lo reciben si ya podían
     * administrar los datos fiscales o si vienen de las plantillas que venden.
     */
    public function up(): void
    {
        DB::table('permissions')->upsert([['code' => 'fiscal.issue', 'module' => 'Ventas', 'label' => 'Emitir facturas electrónicas']], ['code'], ['module', 'label']);
        $roles = DB::table('roles')->whereIn('template_code', ['owner', 'admin', 'manager', 'cashier'])
            ->orWhereIn('id', DB::table('role_permissions')->where('permission_code', 'fiscal.manage')->select('role_id'))
            ->get(['id', 'tenant_id']);
        DB::table('role_permissions')->insertOrIgnore($roles->map(fn ($r) => ['tenant_id' => $r->tenant_id, 'role_id' => $r->id, 'permission_code' => 'fiscal.issue'])->all());
    }

    public function down(): void
    {
        DB::table('role_permissions')->where('permission_code', 'fiscal.issue')->delete();
        DB::table('permissions')->where('code', 'fiscal.issue')->delete();
    }
};
