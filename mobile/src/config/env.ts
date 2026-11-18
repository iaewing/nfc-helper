export const env = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'https://nfc-helper.test/api/v1').replace(/\/+$/, ''),
  appDomain: process.env.EXPO_PUBLIC_APP_DOMAIN ?? 'nfc-helper.test',
} as const;
