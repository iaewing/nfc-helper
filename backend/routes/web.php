<?php

use App\Http\Controllers\StickerFallbackController;
use App\Http\Controllers\WellKnownController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::withoutMiddleware(['web'])->group(function () {
    Route::get('/.well-known/apple-app-site-association', [WellKnownController::class, 'appleAppSiteAssociation'])
        ->name('well-known.aasa');

    Route::get('/.well-known/assetlinks.json', [WellKnownController::class, 'androidAssetLinks'])
        ->name('well-known.assetlinks');
});

Route::get('/t/{uuid}', [StickerFallbackController::class, 'show'])
    ->whereUuid('uuid')
    ->name('stickers.fallback');
