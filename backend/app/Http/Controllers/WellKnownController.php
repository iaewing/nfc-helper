<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class WellKnownController extends Controller
{
    public function appleAppSiteAssociation(): JsonResponse
    {
        $teamId = (string) config('nfc.apple_team_id');
        $bundleId = (string) config('nfc.ios_bundle_id');
        $isConfigured = $teamId !== '' && $teamId !== 'XXXXXXXXXX' && $bundleId !== '';
        $appId = $teamId !== '' ? "{$teamId}.{$bundleId}" : $bundleId;
        $cacheControl = $isConfigured ? 'public, max-age=3600' : 'no-store, no-cache, must-revalidate';

        return response()
            ->json([
                'applinks' => [
                    'details' => [
                        [
                            'appIDs' => [$appId],
                            'components' => [
                                [
                                    '/' => '/t/*',
                                    'comment' => 'NFC sticker tap Universal Links',
                                ],
                            ],
                        ],
                    ],
                ],
            ], 200, [], JSON_UNESCAPED_SLASHES)
            ->header('Content-Type', 'application/json')
            ->header('Cache-Control', $cacheControl);
    }

    public function androidAssetLinks(): JsonResponse
    {
        $packageName = (string) config('nfc.android_package_name');
        $fingerprints = config('nfc.android_sha256_fingerprints', []);
        $isConfigured = $packageName !== '' && is_array($fingerprints) && $fingerprints !== [];
        $cacheControl = $isConfigured ? 'public, max-age=3600' : 'no-store, no-cache, must-revalidate';

        return response()
            ->json([
                [
                    'relation' => ['delegate_permission/common.handle_all_urls'],
                    'target' => [
                        'namespace' => 'android_app',
                        'package_name' => $packageName,
                        'sha256_cert_fingerprints' => $fingerprints,
                    ],
                ],
            ], 200, [], JSON_UNESCAPED_SLASHES)
            ->header('Content-Type', 'application/json')
            ->header('Cache-Control', $cacheControl);
    }
}
