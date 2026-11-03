<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\GiftCard;
use App\Models\GiftCardMovement;
use App\Models\PaymentMethod;
use App\Models\Sale;
use App\Support\AppError;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Illuminate\Support\Carbon;

/**
 * Gift cards (ADR 0015). El saldo cambia solo dentro de la transacción de la venta que la
 * emite, la usa o se anula, con la tarjeta bloqueada y un movimiento de solo agregado.
 */
class GiftCardService
{
    public const MAX_MONTHS = 6;

    /** Sin letras ni números que se confundan al leerlos (O/0, I/1). */
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function today(): string
    {
        return Carbon::now('America/Buenos_Aires')->toDateString();
    }

    /** Lo que escribe o escanea el cajero: sin espacios ni guiones y en mayúsculas. */
    public static function normalize(string $code): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', $code));
    }

    /** active · used (sin saldo) · expired · voided. */
    public static function state(GiftCard $card): string
    {
        return match (true) {
            $card->status === 'voided' => 'voided',
            Money::of($card->balance)->isZero() => 'used',
            $card->expires_on->toDateString() < self::today() => 'expired',
            default => 'active',
        };
    }

    /** Medio interno con el que se registra lo pagado con gift card: se crea la primera vez. */
    public function method(): PaymentMethod
    {
        return PaymentMethod::where('kind', 'gift_card')->first()
            ?? PaymentMethod::create(['name' => 'Gift card', 'kind' => 'gift_card', 'requires_reference' => false, 'sort_order' => 98]);
    }

    /**
     * Bloquea las tarjetas con que se paga y comprueba que se puedan usar por esos importes.
     *
     * @param  list<array{code: string, amount: string}>  $input
     * @return list<array{card: GiftCard, amount: BigDecimal}>
     */
    public function lockForPayment(array $input): array
    {
        $out = [];
        foreach ($input as $i => $g) {
            $code = self::normalize($g['code']);
            $card = GiftCard::where('code', $code)->lockForUpdate()->first();
            $fail = fn (string $message) => AppError::validation([['path' => "giftCards.{$i}.code", 'message' => $message]]);
            if (! $card) {
                throw $fail("No hay ninguna gift card con el código {$code}");
            }
            $amount = BigDecimal::of(Money::round($g['amount']));
            match (self::state($card)) {
                'voided' => throw $fail("La gift card {$code} está anulada"),
                'used' => throw $fail("La gift card {$code} ya no tiene saldo"),
                'expired' => throw $fail("La gift card {$code} venció el ".$card->expires_on->format('d/m/Y')),
                default => null,
            };
            if ($amount->isGreaterThan($card->balance)) {
                throw $fail("La gift card {$code} tiene un saldo de ".Money::pesos($card->balance));
            }
            $out[] = ['card' => $card, 'amount' => $amount];
        }

        return $out;
    }

    /** @param  list<array{card: GiftCard, amount: BigDecimal}>  $cards */
    public function redeem(Actor $actor, array $cards, Sale $sale): void
    {
        foreach ($cards as $c) {
            $balance = Money::of($c['card']->balance)->minus($c['amount']);
            $c['card']->forceFill(['balance' => Money::round($balance)])->save();
            $this->movement($actor, $c['card'], 'redeem', $c['amount']->negated(), $balance, $sale);
        }
    }

    /** Anulación de una venta pagada con gift card: el saldo vuelve a la tarjeta. */
    public function reverse(Actor $actor, Sale $sale): void
    {
        foreach (GiftCardMovement::where('sale_id', $sale->id)->where('kind', 'redeem')->get() as $m) {
            $card = GiftCard::whereKey($m->gift_card_id)->lockForUpdate()->first();
            $balance = Money::of($card->balance)->minus($m->amount);
            $card->forceFill(['balance' => Money::round($balance)])->save();
            $this->movement($actor, $card, 'reversal', BigDecimal::of($m->amount)->negated(), $balance, $sale);
        }
    }

    /** @param  array{amount: string, validMonths: int, recipientName?: ?string, fromName?: ?string}  $input */
    public function issue(Actor $actor, Sale $sale, array $input): GiftCard
    {
        $amount = Money::round($input['amount']);
        $card = GiftCard::create([
            'code' => $this->newCode(),
            'sale_id' => $sale->id,
            'branch_id' => $sale->branch_id,
            'amount' => $amount,
            'balance' => $amount,
            'expires_on' => Carbon::now('America/Buenos_Aires')->addMonthsNoOverflow((int) $input['validMonths'])->toDateString(),
            'recipient_name' => trim((string) ($input['recipientName'] ?? '')) ?: null,
            'from_name' => trim((string) ($input['fromName'] ?? '')) ?: null,
            'status' => 'active',
            'created_by' => $actor->userId,
        ]);
        $this->movement($actor, $card, 'issue', BigDecimal::of($amount), BigDecimal::of($amount), $sale);

        return $card;
    }

    /** Anular la venta que la emitió: solo si nadie la usó todavía. */
    public function voidIssued(Actor $actor, Sale $sale): void
    {
        $card = GiftCard::where('sale_id', $sale->id)->lockForUpdate()->first();
        if (! $card) {
            return;
        }
        if (! Money::of($card->balance)->isEqualTo($card->amount) || $card->status !== 'active') {
            throw AppError::conflict('GIFT_CARD_USED', "La gift card {$card->code} ya se usó: la venta no se puede anular");
        }
        $card->forceFill(['balance' => '0.00', 'status' => 'voided'])->save();
        $this->movement($actor, $card, 'void', BigDecimal::of($card->amount)->negated(), BigDecimal::zero(), $sale);
    }

    private function movement(Actor $actor, GiftCard $card, string $kind, BigDecimal $amount, BigDecimal $balanceAfter, Sale $sale): void
    {
        GiftCardMovement::create([
            'gift_card_id' => $card->id, 'kind' => $kind, 'amount' => Money::round($amount), 'balance_after' => Money::round($balanceAfter),
            'sale_id' => $sale->id, 'branch_id' => $sale->branch_id, 'user_id' => $actor->userId,
        ]);
    }

    /** «GC» y 10 caracteres al azar: más de 10^15 combinaciones, imposible de adivinar probando. */
    private function newCode(): string
    {
        do {
            $code = 'GC';
            for ($i = 0; $i < 10; $i++) {
                $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
        } while (GiftCard::where('code', $code)->exists());

        return $code;
    }
}
