<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    public function show(): JsonResponse
    {
        try {
            DB::select('SELECT 1');
        } catch (Throwable) {
            return $this->json(['status' => 'error', 'db' => 'unreachable'], 503);
        }

        return $this->json(['status' => 'ok', 'db' => 'ok', 'time' => Carbon::now()->toISOString()]);
    }
}
