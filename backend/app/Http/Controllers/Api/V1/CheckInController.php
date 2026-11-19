<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\CheckInRejectedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StoreCheckInRequest;
use App\Models\User;
use App\Services\CheckInService;
use Illuminate\Http\JsonResponse;

class CheckInController extends Controller
{
    public function __construct(
        private readonly CheckInService $checkInService,
    ) {}

    public function store(StoreCheckInRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        try {
            $result = $this->checkInService->record(
                $user,
                $request->validated(),
                $request->file('photo'),
            );
        } catch (CheckInRejectedException $e) {
            return response()->json([
                'code' => $e->errorCode,
                'message' => $e->getMessage(),
                'meta' => $e->meta,
            ], $e->statusCode);
        }

        $checkIn = $result['check_in'];
        $habit = $result['habit'];

        return response()->json([
            'idempotent_replay' => $result['idempotent_replay'],
            'check_in' => [
                'id' => $checkIn->id,
                'client_event_id' => $checkIn->client_event_id,
                'status' => $checkIn->status->value,
                'local_date' => $checkIn->local_date->toDateString(),
                'is_offline_sync' => $checkIn->is_offline_sync,
                'hardware_uid_verified' => $checkIn->hardware_uid_verified,
                'tapped_at' => $checkIn->tapped_at->toIso8601String(),
            ],
            'habit' => [
                'id' => $habit->id,
                'name' => $habit->name,
                'current_streak' => $habit->effectiveCurrentStreak($user->timezone ?: 'UTC'),
                'longest_streak' => $habit->longest_streak,
            ],
        ], $result['idempotent_replay'] ? 200 : 201);
    }
}
