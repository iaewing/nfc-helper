<?php

namespace App\Models;

use App\Enums\CheckInSource;
use App\Enums\CheckInStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'client_event_id',
    'user_id',
    'habit_id',
    'sticker_id',
    'source',
    'hardware_uid_verified',
    'tapped_at',
    'received_at',
    'local_date',
    'is_offline_sync',
    'photo_path',
    'latitude',
    'longitude',
    'distance_meters',
    'status',
    'metadata',
])]
class CheckIn extends Model
{
    protected function casts(): array
    {
        return [
            'source' => CheckInSource::class,
            'status' => CheckInStatus::class,
            'hardware_uid_verified' => 'boolean',
            'tapped_at' => 'datetime',
            'received_at' => 'datetime',
            'local_date' => 'date:Y-m-d',
            'is_offline_sync' => 'boolean',
            'latitude' => 'float',
            'longitude' => 'float',
            'distance_meters' => 'integer',
            'metadata' => 'array',
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

    public function sticker(): BelongsTo
    {
        return $this->belongsTo(Sticker::class);
    }
}
