<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_schedules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('habit_id')->constrained()->cascadeOnDelete();
            $table->string('channel', 24)->default('expo_push');
            $table->string('trigger_type', 32);
            $table->time('send_at_local_time');
            $table->json('days_of_week')->nullable();
            $table->boolean('is_enabled')->default(true);
            $table->timestamp('last_sent_at')->nullable();
            $table->timestamps();

            $table->index(['is_enabled', 'trigger_type']);
            $table->index('habit_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_schedules');
    }
};
