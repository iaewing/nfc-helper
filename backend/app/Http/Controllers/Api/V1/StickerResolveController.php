<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\StickerStatus;
use App\Http\Controllers\Controller;
use App\Models\Sticker;
use App\Models\User;
use App\Services\CheckInService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class StickerResolveController extends Controller
{
    public function __construct(
        private readonly CheckInService $checkInService,
    ) {}

    public function show(Request $request, string $uuid): JsonResponse
    {
        if (! Str::isUuid($uuid)) {
            return response()->json([
                'state' => 'not_found',
                'message' => 'Sticker not found.',
            ], 404);
        }

        $sticker = Sticker::query()
            ->with('habit')
            ->where('uuid', $uuid)
            ->first();

        if ($sticker === null) {
            return response()->json([
                'state' => 'not_found',
                'message' => 'Sticker not found.',
            ], 404);
        }

        if ($sticker->status === StickerStatus::Disabled) {
            return response()->json([
                'state' => 'disabled',
                'message' => 'This sticker has been disabled.',
            ], 410);
        }

        if ($sticker->status === StickerStatus::Unclaimed) {
            return response()->json([
                'state' => 'unclaimed',
                'sticker' => [
                    'uuid' => $sticker->uuid,
                ],
            ]);
        }

        /** @var User $user */
        $user = $request->user();

        if ($sticker->user_id !== $user->id) {
            return response()->json([
                'state' => 'claimed_by_other',
                'message' => 'This sticker is already claimed by another account.',
            ], 403);
        }

        if ($sticker->habit === null) {
            return response()->json([
                'state' => 'owned_unassigned',
                'sticker' => [
                    'uuid' => $sticker->uuid,
                    'label' => $sticker->label,
                ],
            ]);
        }

        $habit = $sticker->habit;
        $eligibility = $this->checkInService->evaluateEligibility(
            $sticker,
            $habit,
            CarbonImmutable::now('UTC'),
            $user->timezone ?: 'UTC',
        );

        return response()->json([
            'state' => 'owned_active',
            'sticker' => [
                'uuid' => $sticker->uuid,
                'label' => $sticker->label,
            ],
            'habit' => [
                'id' => $habit->id,
                'name' => $habit->name,
                'icon' => $habit->icon,
                'verification_type' => $habit->verification_type->value,
                'require_hardware_uid' => $habit->require_hardware_uid,
                'cooldown_minutes' => $habit->cooldown_minutes,
                'current_streak' => $habit->current_streak,
                'longest_streak' => $habit->longest_streak,
            ],
            'eligibility' => $eligibility,
        ]);
    }
}
