# Implementation Plan & Progress Tracker

> System architecture, domain rules, and edge-case specifications live in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Phase Summary

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 1** | Backend Foundation & Universal Link Plumbing | Completed |
| **Phase 2** | Expo Bootstrap, Deep Link Routing & Offline Queue | Completed |
| **Phase 3** | Foreground NFC Claiming, Habit CRUD & Verification UI | Next Up |
| **Phase 4** | Accountability Engine, Push Notifications & Webhooks | Planned |

---

## Phase 1: Backend Foundation & Universal Link Plumbing (Completed)

### 1.1 Database Schema & Domain Models
- [x] Extend `users` table with `timezone`, `expo_push_token`, and `push_enabled` (`backend/database/migrations/2026_11_18_170001_add_accountability_columns_to_users_table.php`)
- [x] Create `habits` table with verification rules, custom weekday schedules, time windows, cooldowns, geofences, and streak counters (`backend/database/migrations/2026_11_18_170002_create_habits_table.php`)
- [x] Create `stickers` table with `uuid`, unique `hardware_uid`, `status`, `batch_code`, and `webhook_token` (`backend/database/migrations/2026_11_18_170003_create_stickers_table.php`)
- [x] Create `check_ins` table with unique `client_event_id`, `source`, `hardware_uid_verified`, `tapped_at`, `received_at`, `local_date`, `is_offline_sync`, photo/location metadata, and indexes (`backend/database/migrations/2026_11_18_170004_create_check_ins_table.php`)
- [x] Create `notification_schedules` table (`backend/database/migrations/2026_11_18_170005_create_notification_schedules_table.php`)
- [x] Implement backed enums (`VerificationType`, `StickerStatus`, `CheckInSource`, `CheckInStatus`) and Eloquent models (`User`, `Habit`, `Sticker`, `CheckIn`, `NotificationSchedule`)
- [x] Build `php artisan stickers:provision` CLI command to batch-generate unclaimed sticker UUIDs and print NDEF URLs (`backend/app/Console/Commands/ProvisionStickersCommand.php`)

### 1.2 Universal Links, App Links & Web Fallback
- [x] Add `backend/config/nfc.php` for Apple Team ID, bundle/package IDs, Android SHA-256 certificate fingerprints, custom scheme, and offline sync thresholds
- [x] Serve `GET /.well-known/apple-app-site-association` and `GET /.well-known/assetlinks.json` without cookie/session middleware (`backend/app/Http/Controllers/WellKnownController.php`)
- [x] Serve `GET /t/{uuid}` mobile web fallback landing page for users without the app installed (`backend/app/Http/Controllers/StickerFallbackController.php`, `backend/resources/views/stickers/fallback.blade.php`)

### 1.3 Sanctum Authentication & Core Check-In API
- [x] Configure Laravel Sanctum personal access tokens and rate limiters (`auth` and `api` throttles)
- [x] Implement `AuthController` (`POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `PATCH /api/v1/auth/me`, `POST /api/v1/auth/logout`)
- [x] Implement `SyncController@bootstrap` (`GET /api/v1/sync/bootstrap`) for mobile offline cache synchronization
- [x] Implement `StickerResolveController@show` (`GET /api/v1/stickers/{uuid}/resolve`) returning sticker ownership state, habit requirements, and real-time check-in eligibility
- [x] Implement `CheckInService` & `CheckInController@store` (`POST /api/v1/check-ins`) with idempotency (`client_event_id`), row locking, hardware UID verification, live photo storage, geofence distance math, overnight schedule window handling, symmetric cooldown checks, and chronological streak recalculation
- [x] Add feature test suites (`AuthApiTest`, `WellKnownTest`, `StickerFallbackTest`, `StickerResolveAndCheckInTest`)

---

## Phase 2: Expo Bootstrap, Deep Link Routing & Offline Queue (Completed)

### 2.1 Expo Configuration & Native Entitlements
- [x] Initialize Expo SDK 58 TypeScript app with `expo-router`, `expo-dev-client`, `react-native-nfc-manager`, `expo-camera`, `expo-location`, `expo-notifications`, and `expo-secure-store` (`mobile/package.json`)
- [x] Configure `mobile/app.config.ts` with iOS `associatedDomains` (`applinks:{APP_DOMAIN}` with optional `?mode=developer`), Android `autoVerify` intent filters for `https://{APP_DOMAIN}/t/`, and `react-native-nfc-manager` plugin with `"includeNdefEntitlement": false`
- [x] Add `mobile/eas.json` profiles (`development`, `simulator`, `preview`, `production`)

### 2.2 Auth Flow & Deep-Link Interception
- [x] Implement encrypted token persistence (`mobile/src/auth/tokenStorage.ts`) and `AuthProvider` (`mobile/src/auth/AuthContext.tsx`)
- [x] Build Login and Register screens (`mobile/app/(auth)/login.tsx`, `mobile/app/(auth)/register.tsx`) that preserve `?redirect=/t/{uuid}` across cold-start authentication
- [x] Build `/t/[uuid]` Universal Link verification screen (`mobile/app/t/[uuid].tsx`) with warm-app re-tap listener, instant check-in for `tap`-only habits, and state cards for `verified`, `queued_offline`, `cooldown`, `needs_photo`, `needs_hardware_uid`, `unclaimed`, and `unassigned`
- [x] Build initial Habits and Stickers tab screens (`mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/stickers.tsx`)

### 2.3 Offline Cache, Queue & CI
- [x] Implement local sticker/habit cache (`mobile/src/offline/stickerCache.ts`) backed by `AsyncStorage`
- [x] Implement FIFO idempotent offline check-in queue (`mobile/src/offline/checkInQueue.ts`) with automatic network-restore flushing and local cooldown checks
- [x] Configure GitHub Actions CI workflow (`.github/workflows/ci.yml`) running `php artisan test` and `npx tsc --noEmit`

---

## Phase 3: Foreground NFC Claiming, Habit CRUD & Verification UI (Next Up)

### 3.1 Backend: Habit CRUD & Sticker Claiming Endpoints
- [ ] **Habit Management API (`backend/app/Http/Controllers/Api/V1/HabitController.php`):**
  - [ ] `GET /api/v1/habits` — list user's habits (active and paused) with attached stickers and effective streaks
  - [ ] `POST /api/v1/habits` — create a habit (`name`, `description`, `icon`, `verification_type`, `require_hardware_uid`, `schedule_type`, `schedule_days`, `window_start`, `window_end`, `cooldown_minutes`, optional `geofence_lat`/`geofence_lng`/`geofence_radius_m`)
  - [ ] `GET /api/v1/habits/{habit}` — inspect habit details and recent check-ins
  - [ ] `PATCH /api/v1/habits/{habit}` — update habit rules, schedule, or active state (`is_active`)
  - [ ] `DELETE /api/v1/habits/{habit}` — soft-delete habit and unassign its stickers (`habit_id = null`)
- [ ] **Sticker Claiming & Assignment API (`backend/app/Http/Controllers/Api/V1/StickerController.php`):**
  - [ ] `POST /api/v1/stickers/claim` — validate `uuid` + 7-byte hex `hardware_uid` (`Sticker::normalizeHardwareUid`), enforce uniqueness of `hardware_uid`, transition sticker from `unclaimed` -> `claimed`, bind `user_id`, generate `webhook_token`, and optionally assign `habit_id` and `label`
  - [ ] `PATCH /api/v1/stickers/{uuid}` — update sticker `label`, reassign `habit_id`, or rotate `webhook_token`
  - [ ] `DELETE /api/v1/stickers/{uuid}/claim` (or unclaim/disable endpoint) — allow users to unbind or disable a lost sticker
- [ ] **Backend Feature Tests:**
  - [ ] Add `backend/tests/Feature/StickerClaimTest.php` covering valid claiming, duplicate `hardware_uid` rejection, already-claimed rejection, and habit assignment
  - [ ] Add `backend/tests/Feature/HabitCrudTest.php` covering schedule validation, geofence validation, and authorization policies

### 3.2 Mobile: Foreground NFC Hook (`react-native-nfc-manager`)
- [ ] Create `mobile/src/nfc/useNfcScanner.ts` to encapsulate cross-platform foreground NFC scanning:
  - [ ] Check hardware support (`NfcManager.isSupported()`) and enabled status (`NfcManager.isEnabled()`)
  - [ ] Request `NfcTech.Ndef` session with clean iOS alert message (`alertMessage`) and guaranteed `cancelTechnologyRequest()` cleanup in `finally`
  - [ ] Parse the NDEF URI record to extract the sticker `uuid` (`/t/{uuid}`)
  - [ ] Extract and normalize `tag.id` into uppercase hex `hardware_uid` (validating 7-byte NTAG213/215 format)
  - [ ] Expose clear error types (`NFC_UNSUPPORTED`, `NFC_DISABLED`, `USER_CANCELLED`, `INVALID_TAG_PAYLOAD`, `MISSING_HARDWARE_UID`)

### 3.3 Mobile: Claiming, Habit Configuration & Verification Flows
- [ ] **Sticker Claiming Screen (`mobile/app/stickers/claim.tsx`):**
  - [ ] Support launching directly from the Stickers tab ("Claim New Sticker") or from `/t/[uuid]` when tapping an `unclaimed` sticker
  - [ ] Guide the user through a foreground NFC scan to read `uuid` + `hardware_uid`
  - [ ] Allow setting a sticker label (e.g., "Coffee Maker", "Gym Bag") and picking an existing habit or creating a new habit inline
  - [ ] Submit to `POST /api/v1/stickers/claim` and refresh the local bootstrap cache
- [ ] **Habit Create / Edit Screens (`mobile/app/habits/new.tsx`, `mobile/app/habits/[id].tsx`):**
  - [ ] Form controls for name, icon, verification mode (`tap`, `tap_photo`, `tap_location`, `tap_photo_location`), high-security hardware UID toggle (`require_hardware_uid`), schedule (`daily` vs `custom_days`), time window, cooldown minutes, and optional geofence capture ("Use Current Location")
- [ ] **Inline Verification Prompts on `/t/[uuid]` (`mobile/app/t/[uuid].tsx`):**
  - [ ] **Foreground Hardware UID Step (`needs_hardware_uid`):** Trigger `useNfcScanner` inline to read `hardware_uid` from the physical tag before submitting `POST /api/v1/check-ins` (`source: 'foreground_scan'`)
  - [ ] **Live Photo Proof Step (`needs_photo`):** Embed live `CameraView` from `expo-camera` (no photo library picker), compress captured image, and upload via `multipart/form-data` to `POST /api/v1/check-ins`
  - [ ] **Location Geofence Step (`tap_location` / `tap_photo_location`):** Request foreground location permission via `expo-location`, capture current coordinates, and include `latitude` and `longitude` in the check-in payload

---

## Phase 4: Accountability Engine, Push Notifications & Webhooks (Planned)

### 4.1 Backend: Push Notification Engine (`NotificationSchedule`)
- [ ] **Notification Schedule CRUD (`backend/app/Http/Controllers/Api/V1/NotificationScheduleController.php`):**
  - [ ] `GET /api/v1/habits/{habit}/notifications`
  - [ ] `POST /api/v1/habits/{habit}/notifications`
  - [ ] `PATCH /api/v1/notifications/{notificationSchedule}`
  - [ ] `DELETE /api/v1/notifications/{notificationSchedule}`
- [ ] **Scheduled Nudge Dispatcher:**
  - [ ] Create console command / queued job (`EvaluateNotificationSchedulesJob`) scheduled every minute in `backend/routes/console.php`
  - [ ] Evaluate active `scheduled_reminder` and `missed_window` schedules against each user's IANA `timezone` and today's verified `check_ins`
  - [ ] Dispatch push notifications to Expo Push API (`https://exp.host/--/api/v2/push/send`) with deep-link payload (`nfchelper://habits/{id}`) and update `last_sent_at`
  - [ ] Add feature tests for timezone boundary evaluation and duplicate-send prevention

### 4.2 Backend: Headless Automation Webhook
- [ ] **Webhook Endpoint (`backend/app/Http/Controllers/Api/V1/WebhookCheckInController.php`):**
  - [ ] `POST /api/v1/webhooks/nfc/{webhook_token}` with dedicated rate limiter
  - [ ] Verify sticker is `claimed` and assigned to an active habit with `verification_type = tap` and `require_hardware_uid = false` (reject photo/location/hardware-UID habits with a descriptive `422` code)
  - [ ] Record check-in via `CheckInService` with `source = CheckInSource::Webhook`
  - [ ] Add feature tests in `backend/tests/Feature/WebhookCheckInTest.php`

### 4.3 Mobile: Push Registration, History Dashboard & Shortcuts Setup
- [ ] Register device Expo push token via `expo-notifications` on login and sync to `PATCH /api/v1/auth/me` (`expo_push_token`)
- [ ] Handle notification tap responses to navigate directly to the relevant habit
- [ ] Build habit streak & check-in history calendar view (`mobile/app/habits/[id].tsx`)
- [ ] Add "Headless Webhook / iOS Shortcuts" section on the sticker detail view allowing power users to copy or rotate their per-sticker webhook URL
