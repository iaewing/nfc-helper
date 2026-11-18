<?php

namespace App\Models;

use App\Enums\VerificationType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable([
    'user_id',
    'name',
    'description',
    'icon',
    'verification_type',
    'require_hardware_uid',
    'schedule_type',
    'schedule_days',
    'window_start',
    'window_end',
    'cooldown_minutes',
    'geofence_lat',
    'geofence_lng',
    'geofence_radius_m',
    'is_active',
    'current_streak',
    'longest_streak',
    'last_checked_in_date',
])]
class Habit extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'verification_type' => VerificationType::class,
            'require_hardware_uid' => 'boolean',
            'schedule_days' => 'array',
            'cooldown_minutes' => 'integer',
            'geofence_lat' => 'float',
            'geofence_lng' => 'float',
            'geofence_radius_m' => 'integer',
            'is_active' => 'boolean',
            'current_streak' => 'integer',
            'longest_streak' => 'integer',
            'last_checked_in_date' => 'date:Y-m-d',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function stickers(): HasMany
    {
        return $this->hasMany(Sticker::class);
    }

    public function checkIns(): HasMany
    {
        return $this->hasMany(CheckIn::class);
    }

    public function notificationSchedules(): HasMany
    {
        return $this->hasMany(NotificationSchedule::class);
    }
}
