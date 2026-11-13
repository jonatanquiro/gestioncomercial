<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends BaseModel
{
    protected $casts = ['active' => 'boolean', 'trial_days' => 'integer', 'sort_order' => 'integer'];

    public function limits(): HasMany
    {
        return $this->hasMany(PlanLimit::class);
    }

    public function features(): HasMany
    {
        return $this->hasMany(PlanFeature::class);
    }

    /** @return array<string, int> */
    public function limitMap(): array
    {
        return $this->limits->mapWithKeys(fn (PlanLimit $l) => [$l->key => (int) $l->value])->all();
    }

    /** @return list<string> */
    public function featureList(): array
    {
        return $this->features->pluck('feature')->sort()->values()->all();
    }
}
