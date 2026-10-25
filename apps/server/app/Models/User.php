<?php

namespace App\Models;

/** Identidad global: una persona puede trabajar en varios comercios con el mismo usuario. */
class User extends BaseModel
{
    protected $hidden = ['password_hash'];

    protected $casts = ['password_changed_at' => 'datetime'];
}
