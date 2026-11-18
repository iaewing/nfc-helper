<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('habits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->string('icon', 50)->nullable();
            $table->string('verification_type', 32)->default('tap');
            $table->boolean('require_hardware_uid')->default(false);
            $table->string('schedule_type', 32)->default('daily');
            $table->json('schedule_days')->nullable();
            $table->time('window_start')->nullable();
            $table->time('window_end')->nullable();
            $table->unsignedInteger('cooldown_minutes')->default(60);
            $table->decimal('geofence_lat', 10, 7)->nullable();
            $table->decimal('geofence_lng', 10, 7)->nullable();
            $table->unsignedInteger('geofence_radius_m')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('current_streak')->default(0);
            $table->unsignedInteger('longest_streak')->default(0);
            $table->date('last_checked_in_date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['user_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('habits');
    }
};
