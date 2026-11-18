<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_fetch_profile_update_timezone_and_logout(): void
    {
        $register = $this->postJson('/api/v1/auth/register', [
            'name' => 'Ian',
            'email' => 'ian@example.com',
            'password' => 'password123',
            'device_name' => 'iPhone 16 Pro',
            'timezone' => 'America/New_York',
        ]);

        $register->assertCreated()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'timezone']]);

        $token = $register->json('token');

        $this->withToken($token)
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('user.timezone', 'America/New_York');

        $this->withToken($token)
            ->patchJson('/api/v1/auth/me', [
                'timezone' => 'America/Los_Angeles',
                'expo_push_token' => 'ExponentPushToken[abc123]',
            ])
            ->assertOk()
            ->assertJsonPath('user.timezone', 'America/Los_Angeles');

        $this->withToken($token)
            ->postJson('/api/v1/auth/logout')
            ->assertOk();

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_issues_token_and_rejects_bad_password(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Ian',
            'email' => 'ian@example.com',
            'password' => 'password123',
            'device_name' => 'iPhone',
        ])->assertCreated();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'ian@example.com',
            'password' => 'wrong-password',
            'device_name' => 'iPhone',
        ])->assertUnprocessable();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'ian@example.com',
            'password' => 'password123',
            'device_name' => 'iPhone',
            'timezone' => 'America/Chicago',
        ])->assertOk()
            ->assertJsonPath('user.timezone', 'America/Chicago')
            ->assertJsonStructure(['token']);
    }
}
