<?php

namespace App\Services;

use App\Enums\CheckInSource;
use App\Enums\CheckInStatus;
use App\Enums\StickerStatus;
use App\Exceptions\CheckInRejectedException;
use App\Models\CheckIn;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class CheckInService
{
    /**
     * @return array{can_check_in: bool, reason: ?string, next_available_at: ?string}
     */
    public function evaluateEligibility(
        Sticker $sticker,
        Habit $habit,
        CarbonImmutable $at,
        string $timezone,
    ): array {
        if (! $habit->is_active) {
            return [
                'can_check_in' => false,
                'reason' => 'HABIT_INACTIVE',
                'next_available_at' => null,
            ];
        }

        $localTime = $at->setTimezone($timezone);

        if ($habit->window_start !== null && $habit->window_end !== null) {
            $currentClock = $localTime->format('H:i:s');
            $start = CarbonImmutable::parse($habit->window_start)->format('H:i:s');
            $end = CarbonImmutable::parse($habit->window_end)->format('H:i:s');

            $inWindow = $start <= $end
                ? ($currentClock >= $start && $currentClock <= $end)
                : ($currentClock >= $start || $currentClock <= $end);

            if (! $inWindow) {
                return [
                    'can_check_in' => false,
                    'reason' => 'OUTSIDE_SCHEDULE_WINDOW',
                    'next_available_at' => null,
                ];
            }
        }

        $logicalLocalTime = $this->resolveLogicalLocalTime($habit, $at, $timezone);

        if ($habit->schedule_type === 'custom_days' && is_array($habit->schedule_days) && $habit->schedule_days !== []) {
            if (! in_array($logicalLocalTime->dayOfWeekIso, array_map('intval', $habit->schedule_days), true)) {
                return [
                    'can_check_in' => false,
                    'reason' => 'OUTSIDE_SCHEDULE_WINDOW',
                    'next_available_at' => null,
                ];
            }
        }

        if ($habit->cooldown_minutes > 0) {
            $windowStart = $at->subMinutes($habit->cooldown_minutes);
            $windowEnd = $at->addMinutes($habit->cooldown_minutes);

            $conflictingCheckIn = CheckIn::query()
                ->where('habit_id', $habit->id)
                ->where('status', CheckInStatus::Verified)
                ->where('tapped_at', '>', $windowStart)
                ->where('tapped_at', '<', $windowEnd)
                ->latest('tapped_at')
                ->first();

            if ($conflictingCheckIn !== null) {
                $cooldownEndsAt = CarbonImmutable::instance($conflictingCheckIn->tapped_at)
                    ->addMinutes($habit->cooldown_minutes);

                return [
                    'can_check_in' => false,
                    'reason' => 'COOLDOWN_ACTIVE',
                    'next_available_at' => $cooldownEndsAt->toIso8601String(),
                ];
            }
        }

        return [
            'can_check_in' => true,
            'reason' => null,
            'next_available_at' => null,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{idempotent_replay: bool, check_in: CheckIn, habit: Habit}
     */
    public function record(User $user, array $data, ?UploadedFile $photo = null): array
    {
        if ($existing = $this->findExistingEvent($user, (string) $data['client_event_id'])) {
            return $existing;
        }

        $sticker = Sticker::query()
            ->where('uuid', $data['sticker_uuid'])
            ->first();

        if ($sticker === null) {
            throw new CheckInRejectedException('STICKER_NOT_FOUND', 'Sticker not found.', 404);
        }

        if ($sticker->status === StickerStatus::Disabled) {
            throw new CheckInRejectedException('STICKER_DISABLED', 'This sticker has been disabled.', 410);
        }

        if ($sticker->user_id !== $user->id || $sticker->status !== StickerStatus::Claimed) {
            throw new CheckInRejectedException('STICKER_NOT_OWNED', 'You do not own this sticker.', 403);
        }

        if ($sticker->habit_id === null) {
            throw new CheckInRejectedException('STICKER_UNASSIGNED', 'Assign a habit to this sticker before checking in.', 422);
        }

        $receivedAt = CarbonImmutable::now('UTC');
        $tappedAt = CarbonImmutable::parse($data['tapped_at'])->utc();

        $maxFutureSeconds = (int) config('nfc.offline_sync_max_future_seconds', 300);
        if ($tappedAt->greaterThan($receivedAt->addSeconds($maxFutureSeconds))) {
            throw new CheckInRejectedException(
                'INVALID_TIMESTAMP',
                'Check-in timestamp is too far in the future.',
                422,
            );
        }

        $maxAgeHours = (int) config('nfc.offline_sync_max_age_hours', 24);
        if ($tappedAt->lessThan($receivedAt->subHours($maxAgeHours))) {
            throw new CheckInRejectedException(
                'OFFLINE_SYNC_TOO_OLD',
                "Offline check-ins must be synced within {$maxAgeHours} hours of tapping.",
                422,
                ['max_age_hours' => $maxAgeHours],
            );
        }

        $providedUid = isset($data['hardware_uid']) && $data['hardware_uid'] !== ''
            ? Sticker::normalizeHardwareUid((string) $data['hardware_uid'])
            : null;

        try {
            /** @var array{idempotent_replay: bool, check_in: CheckIn, habit: Habit} */
            return DB::transaction(function () use (
                $data,
                $user,
                $sticker,
                $providedUid,
                $photo,
                $tappedAt,
                $receivedAt,
            ) {
                $lockedSticker = Sticker::query()->lockForUpdate()->find($sticker->id);

                if ($lockedSticker === null) {
                    throw new CheckInRejectedException('STICKER_NOT_FOUND', 'Sticker not found.', 404);
                }

                if ($lockedSticker->status === StickerStatus::Disabled) {
                    throw new CheckInRejectedException('STICKER_DISABLED', 'This sticker has been disabled.', 410);
                }

                if ($lockedSticker->user_id !== $user->id || $lockedSticker->status !== StickerStatus::Claimed) {
                    throw new CheckInRejectedException('STICKER_NOT_OWNED', 'You do not own this sticker.', 403);
                }

                if ($lockedSticker->habit_id === null) {
                    throw new CheckInRejectedException('STICKER_UNASSIGNED', 'Assign a habit to this sticker before checking in.', 422);
                }

                $lockedHabit = Habit::query()->lockForUpdate()->find($lockedSticker->habit_id);

                if ($lockedHabit === null) {
                    throw new CheckInRejectedException('STICKER_UNASSIGNED', 'Assign a habit to this sticker before checking in.', 422);
                }

                if ($existing = $this->findExistingEvent($user, (string) $data['client_event_id'])) {
                    return $existing;
                }

                $hardwareUidVerified = false;

                if ($lockedHabit->require_hardware_uid) {
                    if ($lockedSticker->hardware_uid === null || $lockedSticker->hardware_uid === '') {
                        throw new CheckInRejectedException(
                            'HARDWARE_UID_NOT_REGISTERED',
                            'This sticker does not have a registered hardware UID.',
                            422,
                        );
                    }

                    if ($providedUid === null) {
                        throw new CheckInRejectedException(
                            'HARDWARE_UID_REQUIRED',
                            'This habit requires a foreground NFC scan to verify the physical sticker.',
                            422,
                        );
                    }
                }

                if ($providedUid !== null && $lockedSticker->hardware_uid !== null && $lockedSticker->hardware_uid !== '') {
                    if (! hash_equals($lockedSticker->hardware_uid, $providedUid)) {
                        throw new CheckInRejectedException(
                            'HARDWARE_UID_MISMATCH',
                            'Scanned hardware UID does not match this registered sticker.',
                            403,
                        );
                    }
                    $hardwareUidVerified = true;
                }

                if ($lockedHabit->verification_type->requiresPhoto() && $photo === null) {
                    throw new CheckInRejectedException(
                        'PHOTO_REQUIRED',
                        'A live photo proof is required to complete this habit.',
                        422,
                    );
                }

                $latitude = isset($data['latitude']) ? (float) $data['latitude'] : null;
                $longitude = isset($data['longitude']) ? (float) $data['longitude'] : null;
                $distanceMeters = null;

                if ($lockedHabit->verification_type->requiresLocation() && ($latitude === null || $longitude === null)) {
                    throw new CheckInRejectedException(
                        'LOCATION_REQUIRED',
                        'Location coordinates are required to complete this habit.',
                        422,
                    );
                }

                if (
                    $latitude !== null &&
                    $longitude !== null &&
                    $lockedHabit->geofence_lat !== null &&
                    $lockedHabit->geofence_lng !== null
                ) {
                    $distanceMeters = $this->calculateDistanceMeters(
                        $latitude,
                        $longitude,
                        $lockedHabit->geofence_lat,
                        $lockedHabit->geofence_lng,
                    );

                    if (
                        $lockedHabit->verification_type->requiresLocation() &&
                        $lockedHabit->geofence_radius_m !== null &&
                        $distanceMeters > $lockedHabit->geofence_radius_m
                    ) {
                        throw new CheckInRejectedException(
                            'OUTSIDE_GEOFENCE',
                            'You are outside the allowed location radius for this habit.',
                            422,
                            [
                                'distance_meters' => $distanceMeters,
                                'allowed_radius_meters' => $lockedHabit->geofence_radius_m,
                            ],
                        );
                    }
                }

                $timezone = $user->timezone ?: 'UTC';
                $eligibility = $this->evaluateEligibility($lockedSticker, $lockedHabit, $tappedAt, $timezone);

                if (! $eligibility['can_check_in']) {
                    $reason = $eligibility['reason'] ?? 'CHECK_IN_NOT_ALLOWED';
                    $statusCode = $reason === 'COOLDOWN_ACTIVE' ? 409 : 422;
                    $message = match ($reason) {
                        'COOLDOWN_ACTIVE' => 'Cooldown is active for this habit. Try again later.',
                        'OUTSIDE_SCHEDULE_WINDOW' => 'This tap is outside the habit schedule window.',
                        'HABIT_INACTIVE' => 'This habit is currently paused.',
                        default => 'Check-in is not allowed right now.',
                    };

                    throw new CheckInRejectedException($reason, $message, $statusCode, [
                        'next_available_at' => $eligibility['next_available_at'],
                    ]);
                }

                $localDate = $this->resolveLogicalLocalTime($lockedHabit, $tappedAt, $timezone)->toDateString();
                $isOfflineSync = $receivedAt->diffInSeconds($tappedAt, true) > 120;
                $photoPath = $photo?->store("check-ins/{$user->id}", 'local');

                try {
                    $checkIn = CheckIn::create([
                        'client_event_id' => $data['client_event_id'],
                        'user_id' => $user->id,
                        'habit_id' => $lockedHabit->id,
                        'sticker_id' => $lockedSticker->id,
                        'source' => CheckInSource::from($data['source']),
                        'hardware_uid_verified' => $hardwareUidVerified,
                        'tapped_at' => $tappedAt,
                        'received_at' => $receivedAt,
                        'local_date' => $localDate,
                        'is_offline_sync' => $isOfflineSync,
                        'photo_path' => $photoPath,
                        'latitude' => $latitude,
                        'longitude' => $longitude,
                        'distance_meters' => $distanceMeters,
                        'status' => CheckInStatus::Verified,
                    ]);

                    if ($lockedSticker->last_tapped_at === null || $tappedAt->greaterThan($lockedSticker->last_tapped_at)) {
                        $lockedSticker->forceFill(['last_tapped_at' => $tappedAt])->save();
                    }

                    $this->recalculateStreak($lockedHabit);

                    return [
                        'idempotent_replay' => false,
                        'check_in' => $checkIn,
                        'habit' => $lockedHabit->fresh(),
                    ];
                } catch (Throwable $e) {
                    if ($photoPath !== null) {
                        Storage::disk('local')->delete($photoPath);
                    }
                    throw $e;
                }
            });
        } catch (UniqueConstraintViolationException) {
            if ($existing = $this->findExistingEvent($user, (string) $data['client_event_id'])) {
                return $existing;
            }

            throw new CheckInRejectedException(
                'CLIENT_EVENT_CONFLICT',
                'This check-in event ID is already claimed.',
                409,
            );
        }
    }

    /**
     * @return ?array{idempotent_replay: bool, check_in: CheckIn, habit: Habit}
     */
    private function findExistingEvent(User $user, string $clientEventId): ?array
    {
        $existing = CheckIn::query()
            ->with('habit')
            ->where('client_event_id', $clientEventId)
            ->first();

        if ($existing === null) {
            return null;
        }

        if ($existing->user_id !== $user->id) {
            throw new CheckInRejectedException(
                'CLIENT_EVENT_CONFLICT',
                'This check-in event ID is already claimed.',
                409,
            );
        }

        return [
            'idempotent_replay' => true,
            'check_in' => $existing,
            'habit' => $existing->habit,
        ];
    }

    private function recalculateStreak(Habit $habit): void
    {
        $dates = CheckIn::query()
            ->where('habit_id', $habit->id)
            ->where('status', CheckInStatus::Verified)
            ->orderBy('local_date')
            ->get(['local_date'])
            ->map(fn (CheckIn $c) => $c->local_date->toDateString())
            ->unique()
            ->values();

        if ($dates->isEmpty()) {
            return;
        }

        $currentRun = 0;
        $longestRun = $habit->longest_streak;
        $prevDate = null;

        foreach ($dates as $date) {
            if ($prevDate === null) {
                $currentRun = 1;
            } else {
                $expectedPrev = $habit->previousScheduledDate($date);
                if ($prevDate >= $expectedPrev && $prevDate < $date) {
                    $currentRun += 1;
                } else {
                    $currentRun = 1;
                }
            }

            if ($currentRun > $longestRun) {
                $longestRun = $currentRun;
            }

            $prevDate = $date;
        }

        $habit->current_streak = $currentRun;
        $habit->longest_streak = $longestRun;
        $habit->last_checked_in_date = $dates->last();
        $habit->save();
    }

    private function resolveLogicalLocalTime(
        Habit $habit,
        CarbonImmutable $at,
        string $timezone,
    ): CarbonImmutable {
        $localTime = $at->setTimezone($timezone);

        if ($habit->window_start !== null && $habit->window_end !== null) {
            $start = CarbonImmutable::parse($habit->window_start)->format('H:i:s');
            $end = CarbonImmutable::parse($habit->window_end)->format('H:i:s');

            if ($start > $end && $localTime->format('H:i:s') <= $end) {
                return $localTime->subDay();
            }
        }

        return $localTime;
    }

    private function calculateDistanceMeters(
        float $lat1,
        float $lon1,
        float $lat2,
        float $lon2,
    ): int {
        $earthRadiusMeters = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return (int) round($earthRadiusMeters * $c);
    }
}
