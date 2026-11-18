<?php

namespace App\Models;

use App\Enums\StickerStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'uuid',
    'hardware_uid',
    'user_id',
    'habit_id',
    'label',
    'status',
    'batch_code',
    'webhook_token',
    'claimed_at',
    'last_tapped_at',
])]
#[Hidden(['webhook_token'])]
class Sticker extends Model
{
    protected function casts(): array
    {
        return [
            'status' => StickerStatus::class,
            'claimed_at' => 'datetime',
            'last_tapped_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function habit(): BelongsTo
    {
        return $this->belongsTo(Habit::class);
    }

    public function checkIns(): HasMany
    {
        return $this->hasMany(CheckIn::class);
    }

    public function tapUrl(): string
    {
        return rtrim((string) config('app.url'), '/').'/t/'.$this->uuid;
    }

    public static function normalizeHardwareUid(string $uid): string
    {
        return strtoupper((string) preg_replace('/[^a-fA-F0-9]/', '', $uid));
    }
}
