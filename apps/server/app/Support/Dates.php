<?php

namespace App\Support;

use DateTimeInterface;
use Illuminate\Support\Carbon;

final class Dates
{
    /** Mismo formato que Date.prototype.toISOString(): UTC con milisegundos. */
    public static function iso(?DateTimeInterface $date): ?string
    {
        return $date === null ? null : Carbon::instance($date)->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}
