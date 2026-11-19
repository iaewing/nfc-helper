<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CheckInController;
use App\Http\Controllers\Api\V1\HabitController;
use App\Http\Controllers\Api\V1\StickerController;
use App\Http\Controllers\Api\V1\StickerResolveController;
use App\Http\Controllers\Api\V1\SyncController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::middleware('throttle:auth')->group(function () {
        Route::post('/auth/register', [AuthController::class, 'register']);
        Route::post('/auth/login', [AuthController::class, 'login']);
    });

    Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::patch('/auth/me', [AuthController::class, 'updateMe']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        Route::get('/sync/bootstrap', [SyncController::class, 'bootstrap']);

        Route::get('/habits', [HabitController::class, 'index']);
        Route::post('/habits', [HabitController::class, 'store']);
        Route::get('/habits/{habit}', [HabitController::class, 'show']);
        Route::patch('/habits/{habit}', [HabitController::class, 'update']);
        Route::delete('/habits/{habit}', [HabitController::class, 'destroy']);

        Route::post('/stickers/claim', [StickerController::class, 'claim']);
        Route::get('/stickers/{uuid}/resolve', [StickerResolveController::class, 'show']);
        Route::get('/stickers/{uuid}', [StickerController::class, 'show']);
        Route::patch('/stickers/{uuid}', [StickerController::class, 'update']);
        Route::delete('/stickers/{uuid}/claim', [StickerController::class, 'destroyClaim']);

        Route::post('/check-ins', [CheckInController::class, 'store']);
    });
});
