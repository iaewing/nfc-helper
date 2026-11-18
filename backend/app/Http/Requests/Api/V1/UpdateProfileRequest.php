<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
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
            'timezone' => ['sometimes', 'string', 'timezone:all'],
            'expo_push_token' => ['sometimes', 'nullable', 'string', 'max:255'],
            'push_enabled' => ['sometimes', 'boolean'],
        ];
    }
}
