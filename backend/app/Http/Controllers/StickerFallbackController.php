<?php

namespace App\Http\Controllers;

use App\Enums\StickerStatus;
use App\Models\Sticker;
use Illuminate\Contracts\View\View;

class StickerFallbackController extends Controller
{
    public function show(string $uuid): View
    {
        $sticker = Sticker::query()
            ->where('uuid', $uuid)
            ->where('status', '!=', StickerStatus::Disabled)
            ->firstOrFail();

        $scheme = (string) config('nfc.custom_scheme', 'nfchelper');

        return view('stickers.fallback', [
            'uuid' => $sticker->uuid,
            'isUnclaimed' => $sticker->status === StickerStatus::Unclaimed,
            'deepLinkUrl' => "{$scheme}://t/{$sticker->uuid}",
            'appStoreUrl' => (string) config('nfc.app_store_url'),
            'playStoreUrl' => (string) config('nfc.play_store_url'),
        ]);
    }
}
