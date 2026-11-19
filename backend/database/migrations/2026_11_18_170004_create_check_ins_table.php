<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('check_ins', function (Blueprint $table) {
            $table->id();
            $table->uuid('client_event_id')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('habit_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sticker_id')->nullable()->constrained()->nullOnDelete();
            $table->string('source', 32);
            $table->boolean('hardware_uid_verified')->default(false);
            $table->timestamp('tapped_at');
            $table->timestamp('received_at');
            $table->date('local_date');
            $table->boolean('is_offline_sync')->default(false);
            $table->string('photo_path', 255)->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->unsignedInteger('distance_meters')->nullable();
            $table->string('status', 24)->default('verified');
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'habit_id', 'local_date']);
            $table->index(['habit_id', 'status', 'tapped_at']);
            $table->index(['sticker_id', 'tapped_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('check_ins');
    }
};
