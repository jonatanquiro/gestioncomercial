<?php

namespace App\Services;

use App\Models\DocumentSequence;
use App\Models\PaymentMethod;
use App\Models\Register;

/**
 * Lo que necesita un comercio o una sucursal para vender: medios de pago, una caja y la
 * numeración de comprobantes. Se llama al dar de alta el comercio y cada sucursal.
 */
class SalesSetup
{
    /** Nombre, tipo, pide referencia, orden. */
    public const DEFAULT_PAYMENT_METHODS = [
        ['Efectivo', 'cash', false, 1],
        ['Débito', 'debit', true, 2],
        ['Crédito', 'credit', true, 3],
        ['Transferencia', 'transfer', true, 4],
        ['QR o billetera', 'qr', true, 5],
    ];

    public const DOC_TYPES = ['sale', 'return'];

    public function forTenant(): void
    {
        foreach (self::DEFAULT_PAYMENT_METHODS as [$name, $kind, $reference, $order]) {
            PaymentMethod::create(['name' => $name, 'kind' => $kind, 'requires_reference' => $reference, 'sort_order' => $order]);
        }
    }

    public function forBranch(string $branchId): void
    {
        Register::create(['branch_id' => $branchId, 'name' => 'Caja 1']);
        foreach (self::DOC_TYPES as $type) {
            DocumentSequence::create(['branch_id' => $branchId, 'doc_type' => $type, 'next_number' => 1]);
        }
    }

    /** Toma el próximo número de la sucursal con la fila bloqueada hasta el fin de la transacción. */
    public function nextNumber(string $branchId, string $docType): int
    {
        $sequence = DocumentSequence::where('branch_id', $branchId)->where('doc_type', $docType)->lockForUpdate()->first()
            ?? DocumentSequence::create(['branch_id' => $branchId, 'doc_type' => $docType, 'next_number' => 1]);
        $number = (int) $sequence->next_number;
        $sequence->forceFill(['next_number' => $number + 1])->save();

        return $number;
    }
}
