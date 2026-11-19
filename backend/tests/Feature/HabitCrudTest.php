<?php

namespace Tests\Feature;

use App\Enums\CheckInSource;
use App\Enums\StickerStatus;
use App\Enums\VerificationType;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class HabitCrudTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_create_list_inspect_update_and_delete_habits(): void
    {
        $user = User::factory()->create(['timezone' => 'UTC']);
        Sanctum::actingAs($user);

        // Create daily tap habit
        $created = $this->postJson('/api/v1/habits', [
            'name' => 'Morning Coffee',
            'description' => 'Tap sticker by the espresso machine',
            'icon' => '☕',
            'verification_type' => 'tap',
            'require_hardware_uid' => true,
            'schedule_type' => 'daily',
            'window_start' => '06:00',
            'window_end' => '11:00',
            'cooldown_minutes' => 120,
        ]);

        $created->assertCreated()
            ->assertJsonPath('habit.name', 'Morning Coffee')
            ->assertJsonPath('habit.require_hardware_uid', true)
            ->assertJsonPath('habit.window_start', '06:00')
            ->assertJsonPath('habit.window_end', '11:00')
            ->assertJsonPath('habit.is_active', true);

        $habitId = $created->json('habit.id');

        // Create a paused habit to ensure index returns both active and paused
        $paused = Habit::create([
            'user_id' => $user->id,
            'name' => 'Paused Stretching',
            'is_active' => false,
            'current_streak' => 4,
            'longest_streak' => 4,
            'last_checked_in_date' => now()->subDays(5)->toDateString(),
        ]);

        // Attach a sticker to the first habit and record a check-in
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'hardware_uid' => '04A1B2C3D4E5F6',
            'user_id' => $user->id,
            'habit_id' => $habitId,
            'label' => 'Espresso Machine',
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        $this->travelTo(now()->setTime(8, 0));

        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::ForegroundNfc->value,
            'tapped_at' => now()->toIso8601String(),
            'hardware_uid' => '04A1B2C3D4E5F6',
        ])->assertCreated();

        // Index returns both active and paused habits with stickers and effective streaks
        $this->getJson('/api/v1/habits')
            ->assertOk()
            ->assertJsonCount(2, 'habits')
            ->assertJsonPath('habits.0.id', $habitId)
            ->assertJsonPath('habits.0.current_streak', 1)
            ->assertJsonPath('habits.0.stickers.0.uuid', $sticker->uuid)
            ->assertJsonPath('habits.1.id', $paused->id)
            ->assertJsonPath('habits.1.is_active', false)
            ->assertJsonPath('habits.1.current_streak', 0);

        // Show returns habit details and recent check-ins
        $this->getJson("/api/v1/habits/{$habitId}")
            ->assertOk()
            ->assertJsonPath('habit.name', 'Morning Coffee')
            ->assertJsonCount(1, 'recent_check_ins')
            ->assertJsonPath('recent_check_ins.0.hardware_uid_verified', true);

        // Update habit schedule & pause it
        $this->patchJson("/api/v1/habits/{$habitId}", [
            'name' => 'Weekday Coffee',
            'schedule_type' => 'custom_days',
            'schedule_days' => [5, 1, 3],
            'is_active' => false,
        ])->assertOk()
            ->assertJsonPath('habit.name', 'Weekday Coffee')
            ->assertJsonPath('habit.schedule_type', 'custom_days')
            ->assertJsonPath('habit.schedule_days', [1, 3, 5])
            ->assertJsonPath('habit.is_active', false);

        // Switching back to daily clears schedule_days
        $this->patchJson("/api/v1/habits/{$habitId}", [
            'schedule_type' => 'daily',
        ])->assertOk()
            ->assertJsonPath('habit.schedule_type', 'daily')
            ->assertJsonPath('habit.schedule_days', null);

        // Soft-deleting detaches bound stickers
        $this->deleteJson("/api/v1/habits/{$habitId}")
            ->assertOk();

        $this->assertSoftDeleted('habits', ['id' => $habitId]);
        $this->assertNull($sticker->fresh()->habit_id);

        $this->getJson('/api/v1/habits')
            ->assertOk()
            ->assertJsonCount(1, 'habits');
    }

    public function test_schedule_and_window_validation_rules(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // custom_days without schedule_days fails
        $this->postJson('/api/v1/habits', [
            'name' => 'Missing Days',
            'schedule_type' => 'custom_days',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['schedule_days']);

        // Invalid weekday number fails
        $this->postJson('/api/v1/habits', [
            'name' => 'Bad Day',
            'schedule_type' => 'custom_days',
            'schedule_days' => [0, 8],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['schedule_days.0', 'schedule_days.1']);

        // Unpaired window_start fails
        $this->postJson('/api/v1/habits', [
            'name' => 'Half Window',
            'window_start' => '07:00',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['window_end']);

        // Identical window_start and window_end fails
        $this->postJson('/api/v1/habits', [
            'name' => 'Zero Window',
            'window_start' => '07:00',
            'window_end' => '07:00',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['window_end']);

        // Overnight window (22:00 -> 02:00) succeeds
        $overnight = $this->postJson('/api/v1/habits', [
            'name' => 'Night Routine',
            'window_start' => '22:00',
            'window_end' => '02:00',
        ]);
        $overnight->assertCreated()
            ->assertJsonPath('habit.window_start', '22:00')
            ->assertJsonPath('habit.window_end', '02:00');

        $habitId = $overnight->json('habit.id');

        // Partial PATCH clearing only window_end fails
        $this->patchJson("/api/v1/habits/{$habitId}", [
            'window_end' => null,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['window_end']);

        // Partial PATCH switching to custom_days without schedule_days fails
        $this->patchJson("/api/v1/habits/{$habitId}", [
            'schedule_type' => 'custom_days',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['schedule_days']);
    }

    public function test_geofence_validation_and_tap_location_verification(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        // tap_location without geofence coordinates fails
        $this->postJson('/api/v1/habits', [
            'name' => 'Gym Check-In',
            'verification_type' => 'tap_location',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['geofence_lat', 'geofence_lng', 'geofence_radius_m']);

        // Partial geofence on tap habit fails
        $this->postJson('/api/v1/habits', [
            'name' => 'Partial Geo',
            'verification_type' => 'tap',
            'geofence_lat' => 40.7128,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['geofence_radius_m']);

        // Valid tap_location habit succeeds
        $created = $this->postJson('/api/v1/habits', [
            'name' => 'Gym Check-In',
            'verification_type' => 'tap_location',
            'geofence_lat' => 40.7128,
            'geofence_lng' => -74.0060,
            'geofence_radius_m' => 150,
        ]);

        $created->assertCreated()
            ->assertJsonPath('habit.verification_type', VerificationType::TapLocation->value)
            ->assertJsonPath('habit.geofence_radius_m', 150);

        $habitId = $created->json('habit.id');

        // Attach sticker and verify tap_location enforces location without requiring a photo
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habitId,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        // Missing location -> 422 LOCATION_REQUIRED
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
        ])->assertUnprocessable()
            ->assertJsonPath('code', 'LOCATION_REQUIRED');

        // Inside geofence without photo -> 201 Created
        $this->postJson('/api/v1/check-ins', [
            'client_event_id' => (string) Str::uuid(),
            'sticker_uuid' => $sticker->uuid,
            'source' => CheckInSource::UniversalLink->value,
            'tapped_at' => now()->toIso8601String(),
            'latitude' => 40.7129,
            'longitude' => -74.0061,
        ])->assertCreated();
    }

    public function test_habit_authorization_policy_blocks_other_users(): void
    {
        $owner = User::factory()->create();
        $intruder = User::factory()->create();

        $habit = Habit::create([
            'user_id' => $owner->id,
            'name' => 'Private Habit',
        ]);

        Sanctum::actingAs($intruder);

        $this->getJson("/api/v1/habits/{$habit->id}")->assertForbidden();
        $this->patchJson("/api/v1/habits/{$habit->id}", ['name' => 'Hacked'])->assertForbidden();
        $this->deleteJson("/api/v1/habits/{$habit->id}")->assertForbidden();

        $this->assertDatabaseHas('habits', [
            'id' => $habit->id,
            'name' => 'Private Habit',
            'deleted_at' => null,
        ]);
    }
}
