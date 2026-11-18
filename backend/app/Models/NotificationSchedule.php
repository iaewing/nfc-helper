<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'user_id',
    'habit_id',
    'channel',
    'trigger_type',
    'send_at_local_time',
    'days_of_week',
    'is_enabled',
    'last_sent_at',
])]
class NotificationSchedule extends Model
{
    protected function casts(): array
    {
        return [
            'days_of_week' => 'array',
            'is_enabled' => 'boolean',
            'last_sent_at' => 'datetime',
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
}
