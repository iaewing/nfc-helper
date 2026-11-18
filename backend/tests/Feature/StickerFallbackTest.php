<?php

namespace Tests\Feature;

use App\Enums\StickerStatus;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class StickerFallbackTest extends TestCase
{
    use RefreshDatabase;

    public function test_valid_sticker_renders_fallback_without_leaking_owner_or_habit_info(): void
    {
        $user = User::factory()->create(['name' => 'Secret Owner Name']);
        $habit = Habit::create([
            'user_id' => $user->id,
            'name' => 'Private Secret Habit',
        ]);
        $sticker = Sticker::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'habit_id' => $habit->id,
            'status' => StickerStatus::Claimed,
            'claimed_at' => now(),
        ]);

        $response = $this->get("/t/{$sticker->uuid}");

        $response->assertOk()
            ->assertSee($sticker->uuid)
            ->assertSee("nfchelper://t/{$sticker->uuid}")
            ->assertDontSee('Secret Owner Name')
            ->assertDontSee('Private Secret Habit');
    }

    public function test_unknown_or_malformed_uuid_returns_404(): void
    {
        $this->get('/t/not-a-uuid')->assertNotFound();
        $this->get('/t/'.Str::uuid())->assertNotFound();
    }
}
