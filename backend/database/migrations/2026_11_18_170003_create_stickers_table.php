<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stickers', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('hardware_uid', 32)->unique()->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('habit_id')->nullable()->constrained()->nullOnDelete();
            $table->string('label', 100)->nullable();
            $table->string('status', 24)->default('unclaimed');
            $table->string('batch_code', 50)->nullable();
            $table->string('webhook_token', 64)->unique()->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('last_tapped_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index('habit_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stickers');
    }
};
