<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Sticker;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ClaimStickerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('uuid'))) {
            $this->merge([
                'uuid' => strtolower(trim($this->input('uuid'))),
            ]);
        }

        if (is_string($this->input('hardware_uid'))) {
            $this->merge([
                'hardware_uid' => Sticker::normalizeHardwareUid($this->input('hardware_uid')),
            ]);
        }

        if (is_string($this->input('label'))) {
            $trimmed = trim($this->input('label'));
            $this->merge([
                'label' => $trimmed === '' ? null : $trimmed,
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $userId = $this->user()?->id;

        return [
            'uuid' => ['required', 'uuid'],
            'hardware_uid' => ['required', 'string', 'regex:/^[0-9A-F]{14}$/'],
            'label' => ['nullable', 'string', 'max:100'],
            'habit_id' => [
                'nullable',
                'integer',
                Rule::exists('habits', 'id')
                    ->where('user_id', $userId)
                    ->whereNull('deleted_at'),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'hardware_uid.regex' => 'Hardware UID must be a valid 7-byte (14 hex character) NFC chip UID.',
        ];
    }
}
