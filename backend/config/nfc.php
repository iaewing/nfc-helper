<?php

return [
    'apple_team_id' => env('APPLE_TEAM_ID', ''),
    'ios_bundle_id' => env('IOS_BUNDLE_ID', 'com.nfchelper.app'),
    'android_package_name' => env('ANDROID_PACKAGE_NAME', 'com.nfchelper.app'),
    'android_sha256_fingerprints' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('ANDROID_SHA256_FINGERPRINTS', ''))
    ))),
    'custom_scheme' => env('APP_CUSTOM_SCHEME', 'nfchelper'),
    'app_store_url' => env('APP_STORE_URL', ''),
    'play_store_url' => env('PLAY_STORE_URL', ''),
    'offline_sync_max_age_hours' => (int) env('OFFLINE_SYNC_MAX_AGE_HOURS', 24),
    'offline_sync_max_future_seconds' => (int) env('OFFLINE_SYNC_MAX_FUTURE_SECONDS', 300),
];
