<?php

namespace Tests\Feature;

use App\Enums\StickerStatus;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StickerClaimTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_claim_unclaimed_sticker_with_normalized_hardware_uid_and_habit(): void
    {
        $user = User::factory()->create();
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Take Vitamins',
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'status' => StickerStatus::Unclaimed,
            'batch_code' => 'BATCH-01',
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/v1/stickers/claim', [
            'uuid' => $sticker->uuid,
            'hardware_uid' => '04:a1:b2:c3:d4:e5:f6',
            'label' => 'Medicine Cabinet',
            'habit_id' => $habit->id,
        ]);

        $response->assertCreated()
            ->assertJsonPath('sticker.uuid', $sticker->uuid)
            ->assertJsonPath('sticker.hardware_uid', '04A1B2C3D4E5F6')
            ->assertJsonPath('sticker.label', 'Medicine Cabinet')
            ->assertJsonPath('sticker.status', StickerStatus::Claimed->value)
            ->assertJsonPath('sticker.habit_id', $habit->id)
            ->assertJsonPath('sticker.habit.name', 'Take Vitamins');

        $fresh = $sticker->fresh();
        $this->assertSame($user->id, $fresh->user_id);
        $this->assertSame('04A1B2C3D4E5F6', $fresh->hardware_uid);
        $this->assertSame(StickerStatus::Claimed, $fresh->status);
        $this->assertNotNull($fresh->webhook_token);
        $this->assertSame(48, strlen($fresh->webhook_token));
        $this->assertNotNull($fresh->claimed_at);
    }

    public function test_claim_rejects_invalid_hardware_uid_duplicate_uid_already_claimed_and_foreign_habit(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $otherHabit = Habit::create([
            'user_id' => $other->id,
            'name' => 'Someone Else Habit',
        ]);

        $alreadyClaimed = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'hardware_uid' => '04112233445566',
            'user_id' => $other->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        $unclaimed = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'status' => StickerStatus::Unclaimed,
        ]);

        $disabled = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'status' => StickerStatus::Disabled,
        ]);

        Sanctum::actingAs($owner);

        // Invalid hardware UID length (not 7-byte / 14 hex chars)
        $this->postJson('/api/v1/stickers/claim', [
            'uuid' => $unclaimed->uuid,
            'hardware_uid' => '04AABB',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['hardware_uid']);

        // Foreign habit_id rejected
        $this->postJson('/api/v1/stickers/claim', [
            'uuid' => $unclaimed->uuid,
            'hardware_uid' => '04AABBCCDDEEFF',
            'habit_id' => $otherHabit->id,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['habit_id']);

        // Duplicate hardware_uid across another sticker rejected with 409
        $this->postJson('/api/v1/stickers/claim', [
            'uuid' => $unclaimed->uuid,
            'hardware_uid' => '04:11:22:33:44:55:66',
        ])->assertStatus(409)
            ->assertJsonPath('code', 'HARDWARE_UID_ALREADY_CLAIMED');

        // Already claimed sticker rejected with 409
        $this->postJson('/api/v1/stickers/claim', [
            'uuid' => $alreadyClaimed->uuid,
            'hardware_uid' => '04AABBCCDDEEFF',
        ])->assertStatus(409)
            ->assertJsonPath('code', 'STICKER_ALREADY_CLAIMED');

        // Disabled sticker rejected with 410
        $this->postJson('/api/v1/stickers/claim', [
            'uuid' => $disabled->uuid,
            'hardware_uid' => '04AABBCCDDEEFF',
        ])->assertStatus(410)
            ->assertJsonPath('code', 'STICKER_DISABLED');
    }

    public function test_owner_can_update_sticker_reassign_habit_rotate_webhook_and_unclaim_or_disable(): void
    {
        $owner = User::factory()->create();
        $intruder = User::factory()->create();

        $habitA = Habit::create(['user_id' => $owner->id, 'name' => 'Habit A']);
        $habitB = Habit::create(['user_id' => $owner->id, 'name' => 'Habit B']);

        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'hardware_uid' => '04AABBCCDDEEFF',
            'user_id' => $owner->id,
            'habit_id' => $habitA->id,
            'label' => 'Desk',
            'status' => StickerStatus::Claimed,
            'webhook_token' => str_repeat('a', 48),
            'claimed_at' => now(),
        ]);

        // Intruder cannot inspect, update, or unclaim
        Sanctum::actingAs($intruder);
        $this->getJson("/api/v1/stickers/{$sticker->uuid}")->assertForbidden();
        $this->patchJson("/api/v1/stickers/{$sticker->uuid}", ['label' => 'Stolen'])->assertForbidden();
        $this->deleteJson("/api/v1/stickers/{$sticker->uuid}/claim")->assertForbidden();

        // Owner updates label, reassigns habit, and rotates webhook token
        Sanctum::actingAs($owner);
        $oldToken = $sticker->webhook_token;

        $this->patchJson("/api/v1/stickers/{$sticker->uuid}", [
            'label' => 'Standing Desk',
            'habit_id' => $habitB->id,
            'rotate_webhook_token' => true,
        ])->assertOk()
            ->assertJsonPath('sticker.label', 'Standing Desk')
            ->assertJsonPath('sticker.habit_id', $habitB->id)
            ->assertJsonPath('webhook_token_rotated', true);

        $this->assertNotSame($oldToken, $sticker->fresh()->webhook_token);

        // Owner can unassign habit explicitly
        $this->patchJson("/api/v1/stickers/{$sticker->uuid}", [
            'habit_id' => null,
        ])->assertOk()
            ->assertJsonPath('sticker.habit_id', null)
            ->assertJsonPath('sticker.habit', null);

        // Owner unclaims sticker -> resets to unclaimed so it can be re-claimed
        $this->deleteJson("/api/v1/stickers/{$sticker->uuid}/claim")
            ->assertOk()
            ->assertJsonPath('status', StickerStatus::Unclaimed->value);

        $unclaimed = $sticker->fresh();
        $this->assertSame(StickerStatus::Unclaimed, $unclaimed->status);
        $this->assertNull($unclaimed->user_id);
        $this->assertNull($unclaimed->hardware_uid);
        $this->assertNull($unclaimed->webhook_token);

        // Re-claim using uppercase UUID and then disable as lost
        $this->postJson('/api/v1/stickers/claim', [
            'uuid' => strtoupper($sticker->uuid),
            'hardware_uid' => '04AABBCCDDEEFF',
            'habit_id' => $habitA->id,
        ])->assertCreated();

        $this->deleteJson("/api/v1/stickers/{$sticker->uuid}/claim?action=disable")
            ->assertOk()
            ->assertJsonPath('status', StickerStatus::Disabled->value);

        $disabled = $sticker->fresh();
        $this->assertSame(StickerStatus::Disabled, $disabled->status);
        $this->assertNull($disabled->habit_id);
        $this->assertNull($disabled->webhook_token);
        $this->assertSame('04AABBCCDDEEFF', $disabled->hardware_uid);

        // Permanently disabled sticker cannot be unclaimed or modified
        $this->deleteJson("/api/v1/stickers/{$sticker->uuid}/claim")
            ->assertStatus(410)
            ->assertJsonPath('code', 'STICKER_DISABLED');
        $this->patchJson("/api/v1/stickers/{$sticker->uuid}", ['label' => 'Nope'])
            ->assertStatus(410)
            ->assertJsonPath('code', 'STICKER_DISABLED');
    }
}
