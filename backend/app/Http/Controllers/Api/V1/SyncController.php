<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\StickerStatus;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SyncController extends Controller
{
    public function bootstrap(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $stickers = $user->stickers()
            ->with('habit')
            ->where('status', StickerStatus::Claimed)
            ->orderBy('id')
            ->get()
            ->map(fn ($sticker) => [
                'uuid' => $sticker->uuid,
                'label' => $sticker->label,
                'habit_id' => $sticker->habit_id,
                'last_tapped_at' => $sticker->last_tapped_at?->toIso8601String(),
                'habit' => $sticker->habit === null ? null : [
                    'id' => $sticker->habit->id,
                    'name' => $sticker->habit->name,
                    'icon' => $sticker->habit->icon,
                    'verification_type' => $sticker->habit->verification_type->value,
                    'require_hardware_uid' => $sticker->habit->require_hardware_uid,
                    'cooldown_minutes' => $sticker->habit->cooldown_minutes,
                    'is_active' => $sticker->habit->is_active,
                    'current_streak' => $sticker->habit->current_streak,
                    'longest_streak' => $sticker->habit->longest_streak,
                    'last_checked_in_date' => $sticker->habit->last_checked_in_date?->toDateString(),
                ],
            ]);

        $habits = $user->habits()
            ->where('is_active', true)
            ->orderBy('id')
            ->get()
            ->map(fn ($habit) => [
                'id' => $habit->id,
                'name' => $habit->name,
                'description' => $habit->description,
                'icon' => $habit->icon,
                'verification_type' => $habit->verification_type->value,
                'require_hardware_uid' => $habit->require_hardware_uid,
                'cooldown_minutes' => $habit->cooldown_minutes,
                'current_streak' => $habit->current_streak,
                'longest_streak' => $habit->longest_streak,
                'last_checked_in_date' => $habit->last_checked_in_date?->toDateString(),
            ]);

        return response()->json([
            'synced_at' => now()->toIso8601String(),
            'stickers' => $stickers,
            'habits' => $habits,
        ]);
    }
}
