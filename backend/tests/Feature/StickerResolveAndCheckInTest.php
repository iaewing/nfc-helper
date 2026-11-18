<?php

namespace Tests\Feature;

use App\Enums\CheckInSource;
use App\Enums\StickerStatus;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
}
