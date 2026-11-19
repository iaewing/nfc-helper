# Prove It (`nfc-helper`)

Physical-digital habit and accountability system powered by NTAG213/215 NFC stickers, Laravel 13, and Expo (React Native).

## Documentation

* **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Technical specification, domain schema, Universal Link / CoreNFC mechanics, anti-cheating rules, offline sync design, and API reference.
* **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** — Phased implementation roadmap and task checklist tracking completed work (Phases 1–2) and upcoming milestones (Phases 3–4).

---

## Local Development Setup

### 1. Backend (`backend/`)

The Laravel 13 backend is served locally using **Laravel Herd** at `https://nfc-helper.test`.

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
```

If linking the `backend/` subdirectory to Herd as `nfc-helper.test`:

```bash
cd backend
herd link nfc-helper
herd secure nfc-helper
```

#### Provisioning Unclaimed Stickers

Generate unclaimed sticker UUIDs and print their NDEF tap URLs (`https://nfc-helper.test/t/{uuid}`):

```bash
cd backend
php artisan stickers:provision 5 --batch=DEV-001
```

#### Verifying Well-Known & Fallback Routes

* iOS Universal Links AASA: `https://nfc-helper.test/.well-known/apple-app-site-association`
* Android App Links: `https://nfc-helper.test/.well-known/assetlinks.json`
* Web Fallback Page: `https://nfc-helper.test/t/{sticker_uuid}`

---

### 2. Mobile App (`mobile/`)

> **Note:** Because `react-native-nfc-manager` requires custom native code and entitlements, use an **Expo Development Build** (`expo-dev-client`) rather than Expo Go.

```bash
cd mobile
npm install --legacy-peer-deps
cp .env.example .env
npx expo start
```

#### Simulating a Sticker Tap (Deep Link)

You can test the `/t/[uuid]` flow in the iOS Simulator or Android Emulator without a physical NFC tag:

```bash
# iOS Simulator
xcrun simctl openurl booted "nfchelper://t/<sticker_uuid>"

# Android Emulator
adb shell am start -W -a android.intent.action.VIEW -d "nfchelper://t/<sticker_uuid>" com.nfchelper.app
```

---

## Running Tests & Typechecks

```bash
# Backend feature & unit tests
cd backend && php artisan test

# Mobile TypeScript check
cd mobile && npx tsc --noEmit
```
