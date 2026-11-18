<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('timezone', 64)->default('UTC')->after('password');
            $table->string('expo_push_token', 255)->nullable()->index()->after('timezone');
            $table->boolean('push_enabled')->default(true)->after('expo_push_token');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['expo_push_token']);
            $table->dropColumn(['timezone', 'expo_push_token', 'push_enabled']);
        });
    }
};
