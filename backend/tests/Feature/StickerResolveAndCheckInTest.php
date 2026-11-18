<?php

namespace Tests\Feature;

use App\Enums\CheckInSource;
use App\Enums\StickerStatus;
use App\Enums\VerificationType;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StickerResolveAndCheckInTest extends TestCase
{
    use RefreshDatabase;

    public function test_resolve_handles_unclaimed_owned_and_foreign_stickers(): void
    {
        $owner = User::factory()->create(['timezone' => 'America/New_York']);
        $other = User::factory()->create();

        $unclaimed = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'status' => StickerStatus::Unclaimed,
        ]);

        $habit = Habit::create([
            'user_id' => $owner->id,
            'name' => 'Drink Water',
            'cooldown_minutes' => 60,
        ]);

        $owned = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $owner->id,
            'habit_id' => $habit->id,
            'label' => 'Coffee Maker',
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($owner);

        $this->getJson("/api/v1/stickers/{$unclaimed->uuid}/resolve")
            ->assertOk()
            ->assertJsonPath('state', 'unclaimed');

        $this->getJson("/api/v1/stickers/{$owned->uuid}/resolve")
            ->assertOk()
            ->assertJsonPath('state', 'owned_active')
            ->assertJsonPath('habit.name', 'Drink Water')
            ->assertJsonPath('eligibility.can_check_in', true);

        Sanctum::actingAs($other);

        $this->getJson("/api/v1/stickers/{$owned->uuid}/resolve")
            ->assertForbidden()
            ->assertJsonPath('state', 'claimed_by_other');
    }

    public function test_check_in_is_idempotent_updates_streak_and_enforces_cooldown(): void
    {
        $user = User::factory()->create(['timezone' => 'America/New_York']);
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Gym Bag',
            'cooldown_minutes' => 60,
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        $eventId = (string) Str::uuid();
        $tappedAt = now()->toIso8601String();

        $first = $this->postJson('/api/v1/check-ins', [
            'client_event_id' => $eventId,
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $tappedAt,
        ]);

        $first->assertCreated()
            ->assertJsonPath('idempotent_replay', false)
            ->assertJsonPath('habit.current_streak', 1);

        // Replaying the exact same client_event_id succeeds idempotently (HTTP 200)
        $replay = $this->postJson('/api/v1/check-ins', [
            'client_event_id' => $eventId,
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $tappedAt,
        ]);

        $replay->assertOk()
            ->assertJsonPath('idempotent_replay', true)
            ->assertJsonPath('habit.current_streak', 1);

        // A brand-new tap within cooldown is rejected with 409 COOLDOWN_ACTIVE
        $spam = $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
        ]);

        $spam->assertStatus(409)
            ->assertJsonPath('code', 'COOLDOWN_ACTIVE');
    }

    public function test_offline_check_in_rejects_backdated_timestamps_beyond_limit(): void
    {
        $user = User::factory()->create(['timezone' => 'UTC']);
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Morning Stretch',
            'cooldown_minutes' => 10,
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        // 48 hours old exceeds 24h limit
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->subHours(48)->toIso8601String(),
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'OFFLINE_SYNC_TOO_OLD');

        // 3 hours old is allowed and flagged as offline sync
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->subHours(3)->toIso8601String(),
        ])->assertCreated()
            ->assertJsonPath('check_in.is_offline_sync', true);
    }

    public function test_sync_bootstrap_returns_claimed_stickers_and_active_habits(): void
    {
        $user = User::factory()->create();
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Take Vitamins',
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'label' => 'Medicine Cabinet',
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        $this->getJson('/api/v1/sync/bootstrap')
            ->assertOk()
            ->assertJsonCount(1, 'stickers')
            ->assertJsonPath('stickers.0.uuid', $sticker->uuid)
            ->assertJsonPath('stickers.0.habit.name', 'Take Vitamins');
    }

    public function test_out_of_order_offline_check_in_succeeds_and_recalculates_streak_and_preserves_latest_tap(): void
    {
        $user = User::factory()->create(['timezone' => 'UTC']);
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Evening Journal',
            'cooldown_minutes' => 60,
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        $todayMorning = CarbonImmutable::now('UTC')->setTime(8, 0);
        $yesterdayNight = $todayMorning->subDay()->setTime(22, 0);
        $this->travelTo($todayMorning->addMinutes(5));

        // 1. Online check-in today at 08:00 is recorded first
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $todayMorning->toIso8601String(),
        ])->assertCreated()
            ->assertJsonPath('habit.current_streak', 1);

        // 2. Queued offline check-in from yesterday at 22:00 (10 hours earlier, within 24h drift limit) arrives next
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $yesterdayNight->toIso8601String(),
        ])->assertCreated()
            ->assertJsonPath('check_in.is_offline_sync', true)
            ->assertJsonPath('habit.current_streak', 2)
            ->assertJsonPath('habit.longest_streak', 2);

        $this->assertEquals(
            $todayMorning->toIso8601String(),
            $sticker->fresh()->last_tapped_at->toIso8601String(),
        );
    }

    public function test_custom_days_schedule_and_overnight_time_window_build_streak_across_non_consecutive_days(): void
    {
        $user = User::factory()->create(['timezone' => 'UTC']);
        // Monday (1), Wednesday (3), Friday (5), overnight window 22:00 -> 02:00
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Night Shift Checklist',
            'schedule_type' => 'custom_days',
            'schedule_days' => [1, 3, 5],
            'window_start' => '22:00',
            'window_end' => '02:00',
            'cooldown_minutes' => 60,
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        // 2026-11-16 is a Monday
        $mondayLate = CarbonImmutable::parse('2026-11-16T23:15:00Z');
        $this->travelTo($mondayLate);

        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $mondayLate->toIso8601String(),
        ])->assertCreated()
            ->assertJsonPath('habit.current_streak', 1);

        // Tuesday (2) should be rejected as OUTSIDE_SCHEDULE_WINDOW
        $tuesdayLate = CarbonImmutable::parse('2026-11-17T23:15:00Z');
        $this->travelTo($tuesdayLate);

        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $tuesdayLate->toIso8601String(),
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'OUTSIDE_SCHEDULE_WINDOW');

        // Wednesday (3) at 15:00 is outside 22:00..02:00 window
        $wednesdayAfternoon = CarbonImmutable::parse('2026-11-18T15:00:00Z');
        $this->travelTo($wednesdayAfternoon);

        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $wednesdayAfternoon->toIso8601String(),
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'OUTSIDE_SCHEDULE_WINDOW');

        // Wednesday (3) at 01:30 is inside the overnight 22:00..02:00 window and increments streak to 2!
        $wednesdayEarly = CarbonImmutable::parse('2026-11-18T01:30:00Z');
        $this->travelTo($wednesdayEarly);

        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => $wednesdayEarly->toIso8601String(),
        ])->assertCreated()
            ->assertJsonPath('habit.current_streak', 2);
    }

    public function test_hardware_uid_enforcement_prevents_null_bypass_and_validates_normalized_uid(): void
    {
        $user = User::factory()->create();
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Strict Vault Check',
            'require_hardware_uid' => true,
        ]);
        $stickerWithoutUid = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'hardware_uid' => null,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        // Passing dummy hardware_uid when sticker has null hardware_uid must be rejected (H2 fix)
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $stickerWithoutUid->uuid,
            'source' => CheckInSource::ForegroundNfc->value,
            'tapped_at' => now()->toIso8601String(),
            'hardware_uid' => '00',
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'HARDWARE_UID_NOT_REGISTERED');

        $stickerWithoutUid->update(['hardware_uid' => '04A1B2C3D4E5F6']);

        // Missing hardware_uid
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $stickerWithoutUid->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'HARDWARE_UID_REQUIRED');

        // Mismatched hardware_uid
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $stickerWithoutUid->uuid,
            'source' => CheckInSource::ForegroundNfc->value,
            'tapped_at' => now()->toIso8601String(),
            'hardware_uid' => '04ffffffffffff',
        ])->assertForbidden()
            ->assertJsonPath('code', 'HARDWARE_UID_MISMATCH');

        // Matching colon-separated lowercase hardware_uid normalizes and succeeds
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $stickerWithoutUid->uuid,
            'source' => CheckInSource::ForegroundNfc->value,
            'tapped_at' => now()->toIso8601String(),
            'hardware_uid' => '04:a1:b2:c3:d4:e5:f6',
        ])->assertCreated()
            ->assertJsonPath('check_in.hardware_uid_verified', true);
    }

    public function test_photo_and_geofence_verification_rules_are_enforced(): void
    {
        Storage::fake('local');

        $user = User::factory()->create();
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Gym Arrival Proof',
            'verification_type' => VerificationType::TapPhotoLocation,
            'geofence_lat' => 40.7128000,
            'geofence_lng' => -74.0060000,
            'geofence_radius_m' => 200,
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        // Missing photo
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
            'latitude' => 40.7128,
            'longitude' => -74.0060,
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'PHOTO_REQUIRED');

        // Outside geofence (> 200m away)
        $this->post('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
            'latitude' => 40.7580,
            'longitude' => -73.9855,
            'photo' => UploadedFile::fake()->image('proof.jpg'),
        ], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'OUTSIDE_GEOFENCE');

        // Inside geofence with live photo succeeds
        $this->post('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
            'latitude' => 40.7129,
            'longitude' => -74.0061,
            'photo' => UploadedFile::fake()->image('proof.jpg'),
        ], ['Accept' => 'application/json'])
            ->assertCreated();
    }

    public function test_soft_deleting_habit_detaches_bound_stickers_and_expired_streak_reads_as_zero(): void
    {
        $user = User::factory()->create(['timezone' => 'UTC']);
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Expired Habit',
            'current_streak' => 5,
            'longest_streak' => 5,
            'last_checked_in_date' => now()->subDays(3)->toDateString(),
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($user);

        // Effective streak is 0 because 3 days were missed
        $this->getJson('/api/v1/sync/bootstrap')
            ->assertOk()
            ->assertJsonPath('habits.0.current_streak', 0)
            ->assertJsonPath('habits.0.longest_streak', 5);

        // Soft-deleting the habit detaches stickers.habit_id
        $habit->delete();
        $this->assertNull($sticker->fresh()->habit_id);
    }
}
