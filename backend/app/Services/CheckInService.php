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
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

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

        if ($habit->schedule_type === 'custom_days' && is_array($habit->schedule_days) && $habit->schedule_days !== []) {
            if (! in_array($localTime->dayOfWeekIso, array_map('intval', $habit->schedule_days), true)) {
                return [
                    'can_check_in' => false,
                    'reason' => 'OUTSIDE_SCHEDULE_WINDOW',
                    'next_available_at' => null,
                ];
            }
        }

        if ($habit->window_start !== null && $habit->window_end !== null) {
            $currentClock = $localTime->format('H:i:s');
            $start = strlen($habit->window_start) === 5 ? $habit->window_start.':00' : $habit->window_start;
            $end = strlen($habit->window_end) === 5 ? $habit->window_end.':00' : $habit->window_end;

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

        if ($habit->cooldown_minutes > 0) {
            $latestCheckIn = CheckIn::query()
                ->where('habit_id', $habit->id)
                ->where('status', CheckInStatus::Verified)
                ->latest('tapped_at')
                ->first();

            if ($latestCheckIn !== null) {
                $cooldownEndsAt = CarbonImmutable::instance($latestCheckIn->tapped_at)
                    ->addMinutes($habit->cooldown_minutes);

                if ($at->lt($cooldownEndsAt)) {
                    return [
                        'can_check_in' => false,
                        'reason' => 'COOLDOWN_ACTIVE',
                        'next_available_at' => $cooldownEndsAt->toIso8601String(),
                    ];
                }
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
        $existing = CheckIn::query()
            ->with('habit')
            ->where('client_event_id', $data['client_event_id'])
            ->first();

        if ($existing !== null) {
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

        $sticker = Sticker::query()
            ->with('habit')
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

        $habit = $sticker->habit;

        if ($habit === null) {
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

        $hardwareUidVerified = false;
        $providedUid = isset($data['hardware_uid']) && $data['hardware_uid'] !== ''
            ? Sticker::normalizeHardwareUid((string) $data['hardware_uid'])
            : null;

        if ($habit->require_hardware_uid && $providedUid === null) {
            throw new CheckInRejectedException(
                'HARDWARE_UID_REQUIRED',
                'This habit requires a foreground NFC scan to verify the physical sticker.',
                422,
            );
        }

        if ($providedUid !== null) {
            if ($sticker->hardware_uid !== null && ! hash_equals($sticker->hardware_uid, $providedUid)) {
                throw new CheckInRejectedException(
                    'HARDWARE_UID_MISMATCH',
                    'Scanned hardware UID does not match this registered sticker.',
                    403,
                );
            }
            $hardwareUidVerified = $sticker->hardware_uid !== null;
        }

        if ($habit->verification_type->requiresPhoto() && $photo === null) {
            throw new CheckInRejectedException(
                'PHOTO_REQUIRED',
                'A live photo proof is required to complete this habit.',
                422,
            );
        }

        $timezone = $user->timezone ?: 'UTC';
        $eligibility = $this->evaluateEligibility($sticker, $habit, $tappedAt, $timezone);

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

        $photoPath = $photo?->store("check-ins/{$user->id}", 'local');
        $localDate = $tappedAt->setTimezone($timezone)->toDateString();
        $isOfflineSync = $receivedAt->diffInSeconds($tappedAt, true) > 120;

        /** @var array{idempotent_replay: bool, check_in: CheckIn, habit: Habit} */
        return DB::transaction(function () use (
            $data,
            $user,
            $habit,
            $sticker,
            $hardwareUidVerified,
            $tappedAt,
            $receivedAt,
            $localDate,
            $isOfflineSync,
            $photoPath,
        ) {
            $lockedHabit = Habit::query()->lockForUpdate()->findOrFail($habit->id);

            $checkIn = CheckIn::create([
                'client_event_id' => $data['client_event_id'],
                'user_id' => $user->id,
                'habit_id' => $lockedHabit->id,
                'sticker_id' => $sticker->id,
                'source' => CheckInSource::from($data['source']),
                'hardware_uid_verified' => $hardwareUidVerified,
                'tapped_at' => $tappedAt,
                'received_at' => $receivedAt,
                'local_date' => $localDate,
                'is_offline_sync' => $isOfflineSync,
                'photo_path' => $photoPath,
                'latitude' => $data['latitude'] ?? null,
                'longitude' => $data['longitude'] ?? null,
                'status' => CheckInStatus::Verified,
            ]);

            $sticker->forceFill(['last_tapped_at' => $tappedAt])->save();

            $this->updateStreak($lockedHabit, $localDate);

            return [
                'idempotent_replay' => false,
                'check_in' => $checkIn,
                'habit' => $lockedHabit->fresh(),
            ];
        });
    }

    private function updateStreak(Habit $habit, string $localDate): void
    {
        $lastDate = $habit->last_checked_in_date?->toDateString();

        if ($lastDate === $localDate) {
            return;
        }

        if ($lastDate !== null) {
            $previousDay = CarbonImmutable::parse($localDate)->subDay()->toDateString();

            if ($lastDate === $previousDay) {
                $habit->current_streak += 1;
            } elseif ($localDate > $lastDate) {
                $habit->current_streak = 1;
            }
        } else {
            $habit->current_streak = 1;
        }

        if ($habit->current_streak > $habit->longest_streak) {
            $habit->longest_streak = $habit->current_streak;
        }

        if ($lastDate === null || $localDate > $lastDate) {
            $habit->last_checked_in_date = $localDate;
        }

        $habit->save();
    }
}
