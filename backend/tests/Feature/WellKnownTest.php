<?php

namespace Tests\Feature;

use Tests\TestCase;

class WellKnownTest extends TestCase
{
    public function test_apple_app_site_association_returns_valid_json_for_tap_paths(): void
    {
        config([
            'nfc.apple_team_id' => 'TEAM123456',
            'nfc.ios_bundle_id' => 'com.nfchelper.app',
        ]);

        $response = $this->get('/.well-known/apple-app-site-association');

        $response->assertOk()
            ->assertHeader('Content-Type', 'application/json')
            ->assertHeader('Cache-Control', 'max-age=3600, public')
            ->assertJson([
                'applinks' => [
                    'details' => [
                        [
                            'appIDs' => ['TEAM123456.com.nfchelper.app'],
                            'components' => [
                                ['/' => '/t/*'],
                            ],
                        ],
                    ],
                ],
            ]);
    }

    public function test_unconfigured_well_known_endpoints_disable_public_caching(): void
    {
        config([
            'nfc.apple_team_id' => 'XXXXXXXXXX',
            'nfc.android_sha256_fingerprints' => [],
        ]);

        $aasa = $this->get('/.well-known/apple-app-site-association');
        $aasa->assertOk();
        $this->assertStringContainsString('no-store', (string) $aasa->headers->get('Cache-Control'));

        $assetLinks = $this->get('/.well-known/assetlinks.json');
        $assetLinks->assertOk();
        $this->assertStringContainsString('no-store', (string) $assetLinks->headers->get('Cache-Control'));
    }

    public function test_android_asset_links_returns_valid_json(): void
    {
        config([
            'nfc.android_package_name' => 'com.nfchelper.app',
            'nfc.android_sha256_fingerprints' => ['AA:BB:CC:DD'],
        ]);

        $response = $this->get('/.well-known/assetlinks.json');

        $response->assertOk()
            ->assertHeader('Content-Type', 'application/json')
            ->assertJson([
                [
                    'relation' => ['delegate_permission/common.handle_all_urls'],
                    'target' => [
                        'namespace' => 'android_app',
                        'package_name' => 'com.nfchelper.app',
                        'sha256_cert_fingerprints' => ['AA:BB:CC:DD'],
                    ],
                ],
            ]);
    }
}
