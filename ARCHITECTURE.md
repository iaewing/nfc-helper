# Project Specification: NFC Accountability & "Prove It" Sticker System

## 1. Product Overview
We are building a physical-digital habit and accountability system inspired by Shelpful's "PROVE IT" stickers. Users purchase or register physical NFC stickers (NTAG213/215) placed in real-world environments (e.g., coffee maker, gym bag, front door, desk) and bind them to recurring habits or tasks. Tapping an unlocked phone to a sticker proves physical presence and triggers task verification, streak tracking, and accountability workflows.

## 2. Tech Stack & Architecture
* **Backend:** Laravel 12+ / 13 (PHP 8.4+), PostgreSQL/MySQL, Redis queues, Laravel Sanctum (API token auth).
* **Mobile App:** React Native with Expo (TypeScript), `expo-router` (file-based routing & Universal Links), Expo Development Builds (`expo-dev-client` — do NOT rely on Expo Go due to native NFC requirements).
* **Key Native Modules:**
  * `react-native-nfc-manager` (configured with `"includeNdefEntitlement": false` in `app.json` to avoid App Store `ITMS-90778` rejections while preserving NDEF read/write via standard `TAG` entitlement).
  * `expo-camera` (live camera capture for photo-proof habits; no gallery picker).
  * `expo-location` (optional coarse geofence validation).
  * `expo-notifications` (actionable push notifications driven by Laravel queues).
  * `expo-secure-store` (Sanctum token persistence).

## 3. Core User Flows & Mechanics

### Flow A: Background Tap (Universal Links / App Links — Primary Daily UX)
1. Stickers come pre-encoded with a locked NDEF URI record: `https://{APP_DOMAIN}/t/{sticker_uuid}`.
2. Tapping an unlocked iOS or Android phone to the sticker without opening the app triggers an OS-level Universal Link (`apple-app-site-association`) / Android App Link (`assetlinks.json`) hosted by Laravel under `public/.well-known/`.
3. Expo Router intercepts `/t/[uuid]` and launches the verification screen immediately.
4. **Web Fallback:** If a user without the app scans a sticker, the web route gracefully renders a landing/download page preserving the `sticker_uuid` for onboarding.

### Flow B: Foreground Scan (Claiming & Provisioning)
1. Inside the app, a user taps "Claim New Sticker" and scans an unassigned tag using `react-native-nfc-manager`.
2. The app reads both the NDEF URL (`sticker_uuid`) and the tag's read-only 7-byte factory hardware serial number (`hardware_uid`).
3. The app sends both to the Laravel API to bind the sticker to the user's account and assign a habit, schedule, and verification rules (e.g., tap-only vs. tap + live photo).

### Flow C: Headless Automation Webhook (Power Users)
* Laravel exposes a signed per-sticker webhook endpoint (`POST /api/webhooks/nfc/{webhook_token}`) so users can trigger completions via iOS Personal Shortcuts or Android Tasker/Automations without launching the app UI.

## 4. Anti-Cheating & Verification Rules
* **Hardware UID Binding:** Pair `sticker_uuid` with the physical NTAG `hardware_uid` upon claiming to prevent URL-copy spoofing.
* **Live-Only Photo Proof:** For habits requiring visual proof, force a live camera capture via `expo-camera` immediately after the NFC tap; disallow uploading existing photos from the camera roll.
* **Replay / Cooldown Windows:** Enforce server-side cooldowns and schedule windows so a single sticker cannot be spammed to farm completions.

## 5. Phased Implementation Roadmap
* **Phase 1: Backend Foundation & Universal Link Plumbing**
  * Laravel database schema (`users`, `stickers`, `habits`, `check_ins`, `notification_schedules`).
  * Sanctum authentication endpoints + `public/.well-known/apple-app-site-association` & `assetlinks.json` routes.
  * Web fallback controller for `/t/{uuid}`.
* **Phase 2: Expo Bootstrap & Deep Link Routing**
  * Initialize Expo TypeScript project with `expo-router`, `expo-dev-client`, and `react-native-nfc-manager`.
  * Configure `app.json` entitlements and associated domains.
  * Build auth flow (`expo-secure-store`) and `/t/[uuid]` deep-link handler.
* **Phase 3: Foreground NFC Claiming & Verification UI**
  * Build custom React Native hook for safe foreground NDEF + hardware UID reading across iOS and Android.
  * Build Sticker Claiming flow, Habit Configuration screen, and Live Photo Proof verification screen.
* **Phase 4: Accountability Engine & Webhooks**
  * Laravel scheduled jobs for missed check-in nudges via `expo-notifications`.
  * Apple Shortcuts / headless webhook endpoint and streak/history dashboard.

---

## Instructions for Planning Session
Using the specification above as our source of truth:
1. Review the architecture for any edge cases (especially around iOS CoreNFC behavior, Universal Link cold-starts, and offline/flaky network handling during a tap).
2. Break **Phase 1** and **Phase 2** down into concrete, step-by-step tasks with exact file paths, database migrations, API contracts, and Expo config snippets so we can start scaffolding the repositories immediately.
