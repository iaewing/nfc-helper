<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\VerificationType;
use App\Models\Habit;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateHabitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'icon' => ['sometimes', 'nullable', 'string', 'max:50'],
            'verification_type' => ['sometimes', 'required', Rule::enum(VerificationType::class)],
            'require_hardware_uid' => ['sometimes', 'boolean'],
            'schedule_type' => ['sometimes', 'required', Rule::in(['daily', 'custom_days'])],
            'schedule_days' => ['sometimes', 'nullable', 'array', 'max:7'],
            'schedule_days.*' => ['integer', 'between:1,7', 'distinct'],
            'window_start' => ['sometimes', 'nullable', 'string', 'regex:/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/'],
            'window_end' => ['sometimes', 'nullable', 'string', 'regex:/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/'],
            'cooldown_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
            'geofence_lat' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'geofence_lng' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'geofence_radius_m' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:50000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                /** @var ?Habit $habit */
                $habit = $this->route('habit');

                $scheduleType = $this->exists('schedule_type')
                    ? $this->input('schedule_type')
                    : ($habit?->schedule_type ?? 'daily');
                $scheduleDays = $this->exists('schedule_days')
                    ? $this->input('schedule_days')
                    : $habit?->schedule_days;

                if ($scheduleType === 'custom_days' && (! is_array($scheduleDays) || $scheduleDays === [])) {
                    $validator->errors()->add(
                        'schedule_days',
                        'Select at least one weekday when using a custom days schedule.',
                    );
                }

                $windowStart = $this->exists('window_start')
                    ? $this->input('window_start')
                    : $habit?->window_start;
                $windowEnd = $this->exists('window_end')
                    ? $this->input('window_end')
                    : $habit?->window_end;

                if (($windowStart === null) !== ($windowEnd === null)) {
                    $missingField = $windowStart === null ? 'window_start' : 'window_end';
                    $validator->errors()->add(
                        $missingField,
                        'Both window_start and window_end must be provided together.',
                    );
                } elseif ($windowStart !== null && $windowEnd !== null) {
                    $startNorm = CarbonImmutable::parse((string) $windowStart)->format('H:i:s');
                    $endNorm = CarbonImmutable::parse((string) $windowEnd)->format('H:i:s');

                    if ($startNorm === $endNorm) {
                        $validator->errors()->add(
                            'window_end',
                            'window_end must differ from window_start.',
                        );
                    }
                }

                $verificationTypeValue = $this->exists('verification_type')
                    ? (string) $this->input('verification_type')
                    : ($habit?->verification_type->value ?? VerificationType::Tap->value);
                $verificationType = VerificationType::from($verificationTypeValue);

                $lat = $this->exists('geofence_lat') ? $this->input('geofence_lat') : $habit?->geofence_lat;
                $lng = $this->exists('geofence_lng') ? $this->input('geofence_lng') : $habit?->geofence_lng;
                $radius = $this->exists('geofence_radius_m') ? $this->input('geofence_radius_m') : $habit?->geofence_radius_m;

                $hasAnyGeo = $lat !== null || $lng !== null || $radius !== null;
                $hasAllGeo = $lat !== null && $lng !== null && $radius !== null;

                if ($verificationType->requiresLocation() && ! $hasAllGeo) {
                    if ($lat === null) {
                        $validator->errors()->add('geofence_lat', 'Geofence latitude is required for location verification.');
                    }
                    if ($lng === null) {
                        $validator->errors()->add('geofence_lng', 'Geofence longitude is required for location verification.');
                    }
                    if ($radius === null) {
                        $validator->errors()->add('geofence_radius_m', 'Geofence radius is required for location verification.');
                    }
                } elseif ($hasAnyGeo && ! $hasAllGeo) {
                    $validator->errors()->add(
                        'geofence_radius_m',
                        'Geofence latitude, longitude, and radius must all be provided together.',
                    );
                }
            },
        ];
    }
}
