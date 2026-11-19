<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateStickerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if ($this->exists('label') && is_string($this->input('label'))) {
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
            'label' => ['sometimes', 'nullable', 'string', 'max:100'],
            'habit_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('habits', 'id')
                    ->where('user_id', $userId)
                    ->whereNull('deleted_at'),
            ],
            'rotate_webhook_token' => ['sometimes', 'boolean'],
        ];
    }
}
