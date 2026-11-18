import { ConfigContext, ExpoConfig } from 'expo/config';

const APP_DOMAIN = process.env.EXPO_PUBLIC_APP_DOMAIN ?? 'nfc-helper.test';
const ASSOCIATED_DOMAIN =
  process.env.EXPO_PUBLIC_IOS_DEV_DOMAIN === 'true'
    ? `applinks:${APP_DOMAIN}?mode=developer`
    : `applinks:${APP_DOMAIN}`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Prove It',
  slug: 'nfc-helper',
  scheme: 'nfchelper',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'com.nfchelper.app',
    supportsTablet: false,
    associatedDomains: [ASSOCIATED_DOMAIN],
    infoPlist: {
      NFCReaderUsageDescription:
        'Scan your Prove It NFC stickers to claim and verify habits.',
      NSCameraUsageDescription:
        'Take a live photo to prove habit completion.',
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE_NAME ?? 'com.nfchelper.app',
    adaptiveIcon: {
      backgroundColor: '#0F172A',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.NFC'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: APP_DOMAIN,
            pathPrefix: '/t/',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-splash-screen',
    [
      'react-native-nfc-manager',
      {
        nfcPermission:
          'Scan your Prove It NFC stickers to claim and verify habits.',
        includeNdefEntitlement: false,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Take a live photo to prove habit completion.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
