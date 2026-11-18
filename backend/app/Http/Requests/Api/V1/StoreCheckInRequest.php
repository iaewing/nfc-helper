<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\CheckInSource;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCheckInRequest extends FormRequest
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
            'client_event_id' => ['required', 'uuid'],
            'sticker_uuid' => ['required', 'uuid'],
            'source' => ['required', Rule::enum(CheckInSource::class)],
            'tapped_at' => ['required', 'date'],
            'hardware_uid' => ['nullable', 'string', 'max:32'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'photo' => ['nullable', 'image', 'max:10240'],
        ];
    }
}
