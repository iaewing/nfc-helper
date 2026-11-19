<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\StickerStatus;
use App\Enums\VerificationType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StoreHabitRequest;
use App\Http\Requests\Api\V1\UpdateHabitRequest;
use App\Models\CheckIn;
use App\Models\Habit;
use App\Models\Sticker;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class HabitController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';

        $habits = $user->habits()
            ->with([
                'stickers' => fn ($query) => $query
                    ->where('status', StickerStatus::Claimed)
                    ->orderBy('id'),
            ])
            ->orderBy('id')
            ->get()
            ->map(fn (Habit $habit) => $this->serializeHabit($habit, $timezone));

        return response()->json([
            'habits' => $habits,
        ]);
    }

    public function store(StoreHabitRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';
        $validated = $request->validated();

        $scheduleType = $validated['schedule_type'] ?? 'daily';
        $scheduleDays = $scheduleType === 'custom_days'
            ? $this->normalizeScheduleDays($validated['schedule_days'] ?? [])
            : null;

        $habit = $user->habits()->create([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'icon' => $validated['icon'] ?? null,
            'verification_type' => $validated['verification_type'] ?? VerificationType::Tap->value,
            'require_hardware_uid' => (bool) ($validated['require_hardware_uid'] ?? false),
            'schedule_type' => $scheduleType,
            'schedule_days' => $scheduleDays,
            'window_start' => $this->normalizeTime($validated['window_start'] ?? null),
            'window_end' => $this->normalizeTime($validated['window_end'] ?? null),
            'cooldown_minutes' => $validated['cooldown_minutes'] ?? 60,
            'geofence_lat' => $validated['geofence_lat'] ?? null,
            'geofence_lng' => $validated['geofence_lng'] ?? null,
            'geofence_radius_m' => $validated['geofence_radius_m'] ?? null,
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        $habit->load([
            'stickers' => fn ($query) => $query
                ->where('status', StickerStatus::Claimed)
                ->orderBy('id'),
        ]);

        return response()->json([
            'habit' => $this->serializeHabit($habit, $timezone),
        ], 201);
    }

    public function show(Request $request, Habit $habit): JsonResponse
    {
        Gate::authorize('view', $habit);

        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';

        $habit->load([
            'stickers' => fn ($query) => $query
                ->where('status', StickerStatus::Claimed)
                ->orderBy('id'),
        ]);

        $recentCheckIns = $habit->checkIns()
            ->latest('tapped_at')
            ->limit(20)
            ->get()
            ->map(fn (CheckIn $checkIn) => [
                'id' => $checkIn->id,
                'client_event_id' => $checkIn->client_event_id,
                'source' => $checkIn->source->value,
                'hardware_uid_verified' => $checkIn->hardware_uid_verified,
                'tapped_at' => $checkIn->tapped_at->toIso8601String(),
                'local_date' => $checkIn->local_date->toDateString(),
                'is_offline_sync' => $checkIn->is_offline_sync,
                'has_photo' => $checkIn->photo_path !== null,
                'distance_meters' => $checkIn->distance_meters,
                'status' => $checkIn->status->value,
            ]);

        return response()->json([
            'habit' => $this->serializeHabit($habit, $timezone),
            'recent_check_ins' => $recentCheckIns,
        ]);
    }

    public function update(UpdateHabitRequest $request, Habit $habit): JsonResponse
    {
        Gate::authorize('update', $habit);

        /** @var User $user */
        $user = $request->user();
        $timezone = $user->timezone ?: 'UTC';
        $validated = $request->validated();

        $updates = [];

        foreach ([
            'name',
            'description',
            'icon',
            'verification_type',
            'require_hardware_uid',
            'schedule_type',
            'cooldown_minutes',
            'geofence_lat',
            'geofence_lng',
            'geofence_radius_m',
            'is_active',
        ] as $field) {
            if (array_key_exists($field, $validated)) {
                $updates[$field] = $validated[$field];
            }
        }

        if (array_key_exists('window_start', $validated)) {
            $updates['window_start'] = $this->normalizeTime($validated['window_start']);
        }
        if (array_key_exists('window_end', $validated)) {
            $updates['window_end'] = $this->normalizeTime($validated['window_end']);
        }

        $effectiveScheduleType = $updates['schedule_type'] ?? $habit->schedule_type;
        if ($effectiveScheduleType === 'daily') {
            $updates['schedule_days'] = null;
        } elseif (array_key_exists('schedule_days', $validated)) {
            $updates['schedule_days'] = $this->normalizeScheduleDays($validated['schedule_days'] ?? []);
        }

        $habit->fill($updates)->save();

        $fresh = $habit->fresh()->load([
            'stickers' => fn ($query) => $query
                ->where('status', StickerStatus::Claimed)
                ->orderBy('id'),
        ]);

        return response()->json([
            'habit' => $this->serializeHabit($fresh, $timezone),
        ]);
    }

    public function destroy(Request $request, Habit $habit): JsonResponse
    {
        Gate::authorize('delete', $habit);

        $habit->delete();

        return response()->json([
            'message' => 'Habit deleted.',
        ]);
    }

    /**
     * @param  array<int, int|string>  $days
     * @return list<int>
     */
    private function normalizeScheduleDays(array $days): array
    {
        $normalized = array_values(array_unique(array_map('intval', $days)));
        sort($normalized);

        return $normalized;
    }

    private function normalizeTime(mixed $value): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        return substr($value, 0, 5);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeHabit(Habit $habit, string $timezone): array
    {
        return [
            'id' => $habit->id,
            'name' => $habit->name,
            'description' => $habit->description,
            'icon' => $habit->icon,
            'verification_type' => $habit->verification_type->value,
            'require_hardware_uid' => $habit->require_hardware_uid,
            'schedule_type' => $habit->schedule_type,
            'schedule_days' => $habit->schedule_days,
            'window_start' => $this->normalizeTime($habit->window_start),
            'window_end' => $this->normalizeTime($habit->window_end),
            'cooldown_minutes' => $habit->cooldown_minutes,
            'geofence_lat' => $habit->geofence_lat,
            'geofence_lng' => $habit->geofence_lng,
            'geofence_radius_m' => $habit->geofence_radius_m,
            'is_active' => $habit->is_active,
            'current_streak' => $habit->effectiveCurrentStreak($timezone),
            'longest_streak' => $habit->longest_streak,
            'last_checked_in_date' => $habit->last_checked_in_date?->toDateString(),
            'stickers' => $habit->relationLoaded('stickers')
                ? $habit->stickers->map(fn (Sticker $sticker) => [
                    'uuid' => $sticker->uuid,
                    'label' => $sticker->label,
                    'last_tapped_at' => $sticker->last_tapped_at?->toIso8601String(),
                ])->values()
                : [],
            'created_at' => $habit->created_at?->toIso8601String(),
            'updated_at' => $habit->updated_at?->toIso8601String(),
        ];
    }
}
