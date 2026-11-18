<?php

namespace Database\Seeders;

use App\Enums\StickerStatus;
use App\Enums\VerificationType;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DevDemoSeeder extends Seeder
{
    public function run(): void
    {
        $user = User::query()->firstOrCreate(
            ['email' => 'demo@nfchelper.test'],
            [
                'name' => 'Demo User',
                'password' => 'password',
                'timezone' => 'America/New_York',
            ],
        );

        $waterHabit = Habit::query()->firstOrCreate(
            ['user_id' => $user->id, 'name' => 'Morning Water Before Coffee'],
            [
                'description' => 'Tap the coffee maker sticker after drinking a glass of water.',
                'icon' => 'water',
                'verification_type' => VerificationType::Tap,
                'cooldown_minutes' => 60,
            ],
        );

        $gymHabit = Habit::query()->firstOrCreate(
            ['user_id' => $user->id, 'name' => 'Gym Bag Packed'],
            [
                'description' => 'Tap and snap a quick live photo of your packed gym bag.',
                'icon' => 'fitness',
                'verification_type' => VerificationType::TapPhoto,
                'cooldown_minutes' => 120,
            ],
        );

        Sticker::query()->firstOrCreate(
            ['uuid' => '11111111-1111-4111-8111-111111111111'],
            [
                'user_id' => $user->id,
                'habit_id' => $waterHabit->id,
                'label' => 'Kitchen Coffee Maker',
                'hardware_uid' => '04A1B2C3D4E501',
                'status' => StickerStatus::Claimed,
                'batch_code' => 'DEV-DEMO',
                'webhook_token' => Str::random(64),
                'claimed_at' => now(),
            ],
        );

        Sticker::query()->firstOrCreate(
            ['uuid' => '22222222-2222-4222-8222-222222222222'],
            [
                'user_id' => $user->id,
                'habit_id' => $gymHabit->id,
                'label' => 'Gym Bag Tag',
                'hardware_uid' => '04A1B2C3D4E502',
                'status' => StickerStatus::Claimed,
                'batch_code' => 'DEV-DEMO',
                'webhook_token' => Str::random(64),
                'claimed_at' => now(),
            ],
        );

        Sticker::query()->firstOrCreate(
            ['uuid' => '33333333-3333-4333-8333-333333333333'],
            [
                'status' => StickerStatus::Unclaimed,
                'batch_code' => 'DEV-DEMO',
            ],
        );
    }
}
