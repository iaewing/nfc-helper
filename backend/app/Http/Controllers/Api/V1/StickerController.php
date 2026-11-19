<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\StickerStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ClaimStickerRequest;
use App\Http\Requests\Api\V1\UpdateStickerRequest;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class StickerController extends Controller
{
    public function show(Request $request, string $uuid): JsonResponse
    {
        $sticker = $this->findByUuid($uuid);

        if ($sticker === null) {
            return response()->json([
                'code' => 'STICKER_NOT_FOUND',
                'message' => 'Sticker not found.',
            ], 404);
        }

        Gate::authorize('view', $sticker);

        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';

        return response()->json([
            'sticker' => $this->serializeSticker($sticker->load('habit'), $timezone),
        ]);
    }

    public function claim(ClaimStickerRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';
        $validated = $request->validated();

        $uuid = (string) $validated['uuid'];
        $hardwareUid = Sticker::normalizeHardwareUid((string) $validated['hardware_uid']);
        $label = $validated['label'] ?? null;
        $habitId = $validated['habit_id'] ?? null;

        try {
            $result = DB::transaction(function () use ($user, $uuid, $hardwareUid, $label, $habitId) {
                $sticker = Sticker::query()
                    ->lockForUpdate()
                    ->where('uuid', $uuid)
                    ->first();

                if ($sticker === null) {
                    return [
                        'error' => [
                            'code' => 'STICKER_NOT_FOUND',
                            'message' => 'Sticker not found.',
                        ],
                        'status' => 404,
                    ];
                }

                if ($sticker->status === StickerStatus::Disabled) {
                    return [
                        'error' => [
                            'code' => 'STICKER_DISABLED',
                            'message' => 'This sticker has been disabled and cannot be claimed.',
                        ],
                        'status' => 410,
                    ];
                }

                if ($sticker->status !== StickerStatus::Unclaimed) {
                    return [
                        'error' => [
                            'code' => 'STICKER_ALREADY_CLAIMED',
                            'message' => 'This sticker has already been claimed.',
                        ],
                        'status' => 409,
                    ];
                }

                if ($sticker->hardware_uid !== null && ! hash_equals($sticker->hardware_uid, $hardwareUid)) {
                    return [
                        'error' => [
                            'code' => 'HARDWARE_UID_MISMATCH',
                            'message' => 'Scanned hardware UID does not match this sticker record.',
                        ],
                        'status' => 409,
                    ];
                }

                $duplicateUid = Sticker::query()
                    ->where('hardware_uid', $hardwareUid)
                    ->where('id', '!=', $sticker->id)
                    ->exists();

                if ($duplicateUid) {
                    return [
                        'error' => [
                            'code' => 'HARDWARE_UID_ALREADY_CLAIMED',
                            'message' => 'This NFC chip hardware UID is already registered to another sticker.',
                        ],
                        'status' => 409,
                    ];
                }

                $sticker->forceFill([
                    'hardware_uid' => $hardwareUid,
                    'user_id' => $user->id,
                    'habit_id' => $habitId,
                    'label' => $label,
                    'status' => StickerStatus::Claimed,
                    'webhook_token' => Str::random(48),
                    'claimed_at' => now(),
                ])->save();

                return [
                    'sticker' => $sticker->fresh()->load('habit'),
                    'status' => 201,
                ];
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json([
                'code' => 'HARDWARE_UID_ALREADY_CLAIMED',
                'message' => 'This NFC chip hardware UID is already registered to another sticker.',
            ], 409);
        }

        if (isset($result['error'])) {
            return response()->json($result['error'], $result['status']);
        }

        /** @var Sticker $claimed */
        $claimed = $result['sticker'];

        return response()->json([
            'sticker' => $this->serializeSticker($claimed, $timezone),
        ], 201);
    }

    public function update(UpdateStickerRequest $request, string $uuid): JsonResponse
    {
        $sticker = $this->findByUuid($uuid);

        if ($sticker === null) {
            return response()->json([
                'code' => 'STICKER_NOT_FOUND',
                'message' => 'Sticker not found.',
            ], 404);
        }

        Gate::authorize('update', $sticker);

        if ($sticker->status === StickerStatus::Disabled) {
            return response()->json([
                'code' => 'STICKER_DISABLED',
                'message' => 'Disabled stickers cannot be modified.',
            ], 410);
        }

        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';
        $validated = $request->validated();

        $updates = [];

        if (array_key_exists('label', $validated)) {
            $updates['label'] = $validated['label'];
        }

        if (array_key_exists('habit_id', $validated)) {
            $updates['habit_id'] = $validated['habit_id'];
        }

        $rotated = false;
        if (! empty($validated['rotate_webhook_token'])) {
            $updates['webhook_token'] = Str::random(48);
            $rotated = true;
        }

        if ($updates !== []) {
            $sticker->forceFill($updates)->save();
        }

        return response()->json([
            'sticker' => $this->serializeSticker($sticker->fresh()->load('habit'), $timezone),
            'webhook_token_rotated' => $rotated,
        ]);
    }

    public function destroyClaim(Request $request, string $uuid): JsonResponse
    {
        $validated = $request->validate([
            'action' => ['sometimes', 'string', Rule::in(['unclaim', 'disable'])],
        ]);

        $sticker = $this->findByUuid($uuid);

        if ($sticker === null) {
            return response()->json([
                'code' => 'STICKER_NOT_FOUND',
                'message' => 'Sticker not found.',
            ], 404);
        }

        Gate::authorize('delete', $sticker);

        if ($sticker->status === StickerStatus::Disabled) {
            return response()->json([
                'code' => 'STICKER_DISABLED',
                'message' => 'This sticker has already been permanently disabled.',
            ], 410);
        }

        $action = $validated['action'] ?? 'unclaim';

        if ($action === 'disable') {
            $sticker->forceFill([
                'status' => StickerStatus::Disabled,
                'habit_id' => null,
                'webhook_token' => null,
            ])->save();

            return response()->json([
                'status' => $sticker->status->value,
                'message' => 'Sticker has been disabled.',
            ]);
        }

        $sticker->forceFill([
            'status' => StickerStatus::Unclaimed,
            'user_id' => null,
            'habit_id' => null,
            'label' => null,
            'hardware_uid' => null,
            'webhook_token' => null,
            'claimed_at' => null,
        ])->save();

        return response()->json([
            'status' => $sticker->status->value,
            'message' => 'Sticker has been unclaimed.',
        ]);
    }

    private function findByUuid(string $uuid): ?Sticker
    {
        $normalized = strtolower(trim($uuid));
        if (! Str::isUuid($normalized)) {
            return null;
        }

        return Sticker::query()->where('uuid', $normalized)->first();
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeSticker(Sticker $sticker, string $timezone): array
    {
        return [
            'uuid' => $sticker->uuid,
            'hardware_uid' => $sticker->hardware_uid,
            'label' => $sticker->label,
            'status' => $sticker->status->value,
            'habit_id' => $sticker->habit_id,
            'claimed_at' => $sticker->claimed_at?->toIso8601String(),
            'last_tapped_at' => $sticker->last_tapped_at?->toIso8601String(),
            'habit' => $sticker->habit === null ? null : [
                'id' => $sticker->habit->id,
                'name' => $sticker->habit->name,
                'icon' => $sticker->habit->icon,
                'verification_type' => $sticker->habit->verification_type->value,
                'require_hardware_uid' => $sticker->habit->require_hardware_uid,
                'cooldown_minutes' => $sticker->habit->cooldown_minutes,
                'is_active' => $sticker->habit->is_active,
                'current_streak' => $sticker->habit->effectiveCurrentStreak($timezone),
                'longest_streak' => $sticker->habit->longest_streak,
                'last_checked_in_date' => $sticker->habit->last_checked_in_date?->toDateString(),
            ],
        ];
    }
}
