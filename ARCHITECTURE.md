# Architecture & Technical Specification: NFC Accountability ("Prove It") System

> For phase-by-phase progress tracking and upcoming tasks, see [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

## 1. Product Overview

We are building a physical-digital habit and accountability system inspired by Shelpful's "PROVE IT" stickers. Users register physical NFC stickers (NTAG213/215) placed in real-world environments (e.g., coffee maker, gym bag, front door, desk) and bind them to recurring habits or tasks. Tapping an unlocked phone to a sticker proves physical presence and triggers task verification, streak tracking, and accountability workflows.

---

## 2. Tech Stack & Repository Layout

```text
nfc-helper/
├── ARCHITECTURE.md          # System architecture, domain model, and edge-case design
├── IMPLEMENTATION_PLAN.md   # Trackable phased implementation plan & checklist
├── README.md                # Local setup, development workflow, and testing guide
├── backend/                 # Laravel 13 API & web fallback application
└── mobile/                  # Expo (React Native + TypeScript + Expo Router) client
```

* **Backend (`backend/`):** Laravel 13 (PHP 8.3/8.4+), PostgreSQL/MySQL (SQLite for local dev & tests), Redis queues, Laravel Sanctum (API token auth). Served locally via Laravel Herd (`nfc-helper.test` / `backend.test`).
* **Mobile App (`mobile/`):** React Native with Expo SDK 58 (TypeScript), `expo-router` (file-based routing & Universal Links), Expo Development Builds (`expo-dev-client` — Expo Go is unsupported due to native NFC requirements).
* **Key Native Modules:**
  * `react-native-nfc-manager` — configured with `"includeNdefEntitlement": false` in `mobile/app.config.ts` to avoid App Store `ITMS-90778` rejections on modern Xcode while preserving NDEF read/write and hardware UID reading via the standard `TAG` (`NFCTagReaderSession`) entitlement.
  * `expo-camera` — live camera capture for photo-proof habits (no gallery picker).
  * `expo-location` — optional coarse/fine geofence validation (`Haversine` distance check).
  * `expo-notifications` — actionable push notifications driven by Laravel queues.
  * `expo-secure-store` — encrypted Sanctum bearer token persistence.
  * `@react-native-async-storage/async-storage` & `@react-native-community/netinfo` — offline sticker cache and idempotent check-in queue.

---

## 3. Core User Flows & Mechanics

### Flow A: Background Tap (Universal Links / App Links — Primary Daily UX)
1. Stickers come pre-encoded with a locked NDEF URI record: `https://{APP_DOMAIN}/t/{sticker_uuid}`.
2. Tapping an unlocked iOS or Android phone to the sticker without opening the app triggers an OS-level Universal Link (`/.well-known/apple-app-site-association`) or Android App Link (`/.well-known/assetlinks.json`) hosted by Laravel.
3. Expo Router intercepts `/t/[uuid]` (`mobile/app/t/[uuid].tsx`) and immediately resolves the sticker:
   * If unauthenticated, redirects to `/(auth)/login?redirect=/t/{uuid}` and resumes verification after sign-in.
   * For standard `tap` habits (`require_hardware_uid = false`), records the check-in in a single tap with zero extra prompts.
   * For habits requiring live photo proof or foreground hardware UID verification, prompts the user inline on `/t/[uuid]`.
4. **Web Fallback:** If a user without the app installed scans a sticker, `GET /t/{uuid}` renders a mobile web landing page (`StickerFallbackController`) with deep-link (`nfchelper://t/{uuid}`) and App Store / Play Store download links while preserving the `sticker_uuid`.

### Flow B: Foreground Scan (Claiming & Hardware UID Verification)
1. Inside the app, a user taps **Claim New Sticker** and scans an unassigned tag using `react-native-nfc-manager`.
2. The app starts a foreground NFC session (`NfcTech.Ndef`), reads the NDEF URI (`sticker_uuid`) **and** extracts the NTAG213/215 read-only 7-byte factory serial number (`tag.id` -> normalized uppercase hex `hardware_uid`, e.g., `04A1B2C3D4E5F6`).
3. The app submits both `uuid` and `hardware_uid` to the Laravel API to permanently bind the physical chip to the user's account and assign a habit, schedule, and verification rules.

### Flow C: Headless Automation Webhook (Power Users)
* Laravel exposes a per-sticker webhook endpoint (`POST /api/v1/webhooks/nfc/{webhook_token}`) so users can trigger completions via iOS Personal Automations (Shortcuts) or Android Tasker without launching the app UI (available for `tap`-only habits where `require_hardware_uid = false`).

---

## 4. Domain Model & Database Schema

### `users`
* `id`, `name`, `email`, `password`
* `timezone` (`string`, default `'UTC'`) — IANA timezone used to evaluate habit schedule windows and compute logical check-in dates (`local_date`).
* `expo_push_token` (`string`, nullable, indexed), `push_enabled` (`boolean`, default `true`)

### `habits`
* `id`, `user_id` (FK -> `users`)
* `name`, `description`, `icon`
* `verification_type` (`App\Enums\VerificationType`: `tap`, `tap_photo`, `tap_location`, `tap_photo_location`)
* `require_hardware_uid` (`boolean`, default `false`) — when `true`, requires a foreground NFC scan matching the sticker's 7-byte `hardware_uid` on every check-in.
* `schedule_type` (`daily` | `custom_days`), `schedule_days` (JSON array of ISO weekdays `1..7`)
* `window_start`, `window_end` (`time`, nullable) — supports both same-day windows (`06:00`–`10:00`) and overnight windows crossing midnight (`22:00`–`02:00`).
* `cooldown_minutes` (`unsignedInteger`, default `60`)
* `geofence_lat`, `geofence_lng`, `geofence_radius_m` (nullable)
* `is_active` (`boolean`), `current_streak`, `longest_streak`, `last_checked_in_date` (`date`, nullable)
* `timestamps`, `softDeletes`

### `stickers`
* `id`, `uuid` (unique UUID encoded in the NDEF URL)
* `hardware_uid` (`string(32)`, unique, nullable) — normalized uppercase hex (14 hex chars for 7-byte NTAG213/215 UID).
* `user_id` (nullable FK -> `users`), `habit_id` (nullable FK -> `habits`)
* `label` (`string(100)`, nullable)
* `status` (`App\Enums\StickerStatus`: `unclaimed`, `claimed`, `disabled`)
* `batch_code` (`string(50)`, nullable)
* `webhook_token` (`string(64)`, unique, nullable)
* `claimed_at`, `last_tapped_at`, `timestamps`

### `check_ins`
* `id`, `client_event_id` (unique UUID generated by the client at tap time for idempotency)
* `user_id`, `habit_id`, `sticker_id`
* `source` (`App\Enums\CheckInSource`: `universal_link`, `foreground_scan`, `webhook`)
* `hardware_uid_verified` (`boolean`, default `false`)
* `tapped_at` (client UTC timestamp of physical tap), `received_at` (server UTC timestamp), `local_date` (logical date in user's timezone)
* `is_offline_sync` (`boolean`, true when `|received_at - tapped_at| > 120s`)
* `photo_path`, `latitude`, `longitude`, `distance_meters`
* `status` (`App\Enums\CheckInStatus`: `verified`, `rejected`), `metadata` (JSON)

### `notification_schedules`
* `id`, `user_id`, `habit_id`
* `channel` (`expo_push`), `trigger_type` (`scheduled_reminder` | `missed_window`)
* `send_at_local_time` (`time`), `days_of_week` (JSON), `is_enabled` (`boolean`), `last_sent_at`

---

## 5. Anti-Cheating, Edge Cases & Reliability Rules

### 5.1 iOS CoreNFC & Universal Link Constraints
* **Background Tag Reading cannot read `hardware_uid`:** When iOS reads an NDEF URL in the background, it launches the app via `NSUserActivity` (`NSUserActivityTypeBrowsingWeb`) with only the URL (`https://{APP_DOMAIN}/t/{uuid}`). It does **not** expose the `NFCNDEFTag` object or the 7-byte `hardware_uid`.
* **Two-Tier Security Model:**
  1. **Claiming always requires a foreground scan:** Binding a sticker to an account requires reading both the NDEF UUID and the physical 7-byte `hardware_uid` via `react-native-nfc-manager`.
  2. **Daily Check-Ins:** Standard habits (`require_hardware_uid = false`) complete immediately from the OS background Universal Link tap. High-security habits (`require_hardware_uid = true`) prompt the user on `/t/[uuid]` to hold their phone to the sticker for a second-stage foreground chip scan.
* **Warm-App Re-Tap Handling:** If the app is already mounted on `/t/[uuid]` and the user taps the same sticker again, `Linking.addEventListener('url', ...)` increments a `tapNonce` in `mobile/app/t/[uuid].tsx` so the verification effect re-runs cleanly.

### 5.2 Offline & Flaky Network Handling
* **Local Bootstrap Cache (`mobile/src/offline/stickerCache.ts`):** When online, the app caches the user's claimed stickers and assigned habit rules via `GET /api/v1/sync/bootstrap`.
* **Idempotent Offline Queue (`mobile/src/offline/checkInQueue.ts`):**
  * Every tap generates a `client_event_id` (UUID v4) and captures `tapped_at` at the exact moment of the tap.
  * If offline (or if the network request times out / fails with a transport error) and the habit is a `tap`-only habit (`require_hardware_uid = false`), the tap is validated against local cooldown state (`last_tapped_at` + queued events) and persisted to `AsyncStorage`.
  * When connectivity returns (or prior to the next online check-in), the queue flushes sequentially in FIFO order.
  * Permanent `4xx` rejections (`403`, `404`, `409`, `410`, `422`) are dropped from the queue so they cannot block subsequent taps; `401` halts flushing until re-authenticated; `429` / `5xx` / network errors stay queued for retry.

### 5.3 Server-Side Validation, Cooldowns & Streak Calculation
* **Timestamp Drift Protection (`CheckInService`):**
  * Rejects check-ins with `tapped_at` more than `300` seconds (`config('nfc.offline_sync_max_future_seconds')`) in the future (`INVALID_TIMESTAMP`).
  * Rejects offline check-ins older than `24` hours (`config('nfc.offline_sync_max_age_hours')`) (`OFFLINE_SYNC_TOO_OLD`).
* **Symmetric Cooldown Enforcement:** Cooldown checks query `tapped_at` within `[tapped_at - cooldown_minutes, tapped_at + cooldown_minutes]` under row-level locks (`lockForUpdate()`) so out-of-order offline syncs cannot bypass cooldown windows.
* **Overnight Window & Logical Date Resolution:** If a habit has an overnight schedule window (`window_start > window_end`, e.g., `22:00` to `02:00`), taps occurring after midnight up to `window_end` resolve to the previous calendar day's `local_date` and weekday schedule.
* **Chronological Streak Recalculation:** `CheckInService::recalculateStreak()` recomputes `current_streak`, `longest_streak`, and `last_checked_in_date` over all verified `local_date` entries in ascending order, supporting both `daily` and `custom_days` schedules and decaying `effectiveCurrentStreak()` to `0` if the most recent scheduled day was missed.

---

## 6. API Surface Overview

### Web & Well-Known Routes (`backend/routes/web.php`)
| Method | Path | Controller | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/.well-known/apple-app-site-association` | `WellKnownController@appleAppSiteAssociation` | iOS Universal Links manifest for `/t/*` (without `web` session/cookie middleware) |
| `GET` | `/.well-known/assetlinks.json` | `WellKnownController@androidAssetLinks` | Android App Links Digital Asset Links JSON |
| `GET` | `/t/{uuid}` | `StickerFallbackController@show` | Mobile web fallback landing page for browsers without the app installed |

### REST API v1 (`backend/routes/api.php`)
| Method | Path | Status | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Implemented | Register account & issue Sanctum token |
| `POST` | `/api/v1/auth/login` | Implemented | Authenticate & issue Sanctum token |
| `GET` | `/api/v1/auth/me` | Implemented | Fetch current user profile |
| `PATCH` | `/api/v1/auth/me` | Implemented | Update timezone, push token, or profile |
| `POST` | `/api/v1/auth/logout` | Implemented | Revoke current Sanctum token |
| `GET` | `/api/v1/sync/bootstrap` | Implemented | Pull claimed stickers & active habits for offline cache |
| `GET` | `/api/v1/stickers/{uuid}/resolve` | Implemented | Resolve sticker state, habit requirements & check-in eligibility |
| `POST` | `/api/v1/check-ins` | Implemented | Record idempotent check-in (JSON or `multipart/form-data` with photo) |
| `POST` | `/api/v1/stickers/claim` | Phase 3 | Claim an unclaimed sticker with `uuid` + 7-byte `hardware_uid` |
| `PATCH` | `/api/v1/stickers/{uuid}` | Phase 3 | Update sticker label or assigned `habit_id` |
| `GET/POST/PATCH/DELETE` | `/api/v1/habits` | Phase 3 | Full CRUD for habits, schedules, and verification rules |
| `GET/POST/PATCH/DELETE` | `/api/v1/habits/{habit}/notifications` | Phase 4 | Configure reminder and missed-window push schedules |
| `POST` | `/api/v1/webhooks/nfc/{webhook_token}` | Phase 4 | Headless check-in trigger for iOS Shortcuts / Android Tasker |
