<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class WellKnownController extends Controller
{
    public function appleAppSiteAssociation(): JsonResponse
    {
        $teamId = (string) config('nfc.apple_team_id');
        $bundleId = (string) config('nfc.ios_bundle_id');
        $appId = $teamId !== '' ? "{$teamId}.{$bundleId}" : $bundleId;

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
            ->header('Cache-Control', 'public, max-age=3600');
    }

    public function androidAssetLinks(): JsonResponse
    {
        return response()
            ->json([
                [
                    'relation' => ['delegate_permission/common.handle_all_urls'],
                    'target' => [
                        'namespace' => 'android_app',
                        'package_name' => (string) config('nfc.android_package_name'),
                        'sha256_cert_fingerprints' => config('nfc.android_sha256_fingerprints', []),
                    ],
                ],
            ], 200, [], JSON_UNESCAPED_SLASHES)
            ->header('Content-Type', 'application/json')
            ->header('Cache-Control', 'public, max-age=3600');
    }
}
