export interface User {
  id: number;
  name: string;
  email: string;
  timezone: string;
  push_enabled?: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type VerificationType =
  | 'tap'
  | 'tap_photo'
  | 'tap_location'
  | 'tap_photo_location';

export type ScheduleType = 'daily' | 'custom_days';

export interface HabitSummary {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  verification_type: VerificationType;
  require_hardware_uid: boolean;
  cooldown_minutes: number;
  is_active?: boolean;
  current_streak: number;
  longest_streak: number;
  last_checked_in_date?: string | null;
}

export interface HabitStickerRef {
  uuid: string;
  label: string | null;
  last_tapped_at: string | null;
}

export interface Habit extends HabitSummary {
  description: string | null;
  icon: string | null;
  schedule_type: ScheduleType;
  schedule_days: number[] | null;
  window_start: string | null;
  window_end: string | null;
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number | null;
  is_active: boolean;
  last_checked_in_date: string | null;
  stickers: HabitStickerRef[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RecentCheckIn {
  id: number;
  client_event_id: string;
  source: CheckInSource;
  hardware_uid_verified: boolean;
  tapped_at: string;
  local_date: string;
  is_offline_sync: boolean;
  has_photo: boolean;
  distance_meters: number | null;
  status: string;
}

export interface HabitsListResponse {
  habits: Habit[];
}

export interface HabitMutationResponse {
  habit: Habit;
}

export interface HabitDetailResponse {
  habit: Habit;
  recent_check_ins: RecentCheckIn[];
}

export interface HabitPayload {
  name: string;
  description?: string | null;
  icon?: string | null;
  verification_type: VerificationType;
  require_hardware_uid: boolean;
  schedule_type: ScheduleType;
  schedule_days?: number[] | null;
  window_start?: string | null;
  window_end?: string | null;
  cooldown_minutes: number;
  geofence_lat?: number | null;
  geofence_lng?: number | null;
  geofence_radius_m?: number | null;
  is_active?: boolean;
}

export type HabitUpdatePayload = Partial<HabitPayload>;

export interface StickerDetail {
  uuid: string;
  hardware_uid: string | null;
  label: string | null;
  status: 'unclaimed' | 'claimed' | 'disabled';
  habit_id: number | null;
  claimed_at: string | null;
  last_tapped_at: string | null;
  habit: HabitSummary | null;
}

export interface ClaimStickerPayload {
  uuid: string;
  hardware_uid: string;
  label?: string | null;
  habit_id?: number | null;
}

export interface UpdateStickerPayload {
  label?: string | null;
  habit_id?: number | null;
  rotate_webhook_token?: boolean;
}

export interface StickerResponse {
  sticker: StickerDetail;
  webhook_token_rotated?: boolean;
}

export interface UnclaimStickerResponse {
  status: 'unclaimed' | 'disabled';
  message: string;
}

export interface CachedSticker {
  uuid: string;
  label: string | null;
  habit_id: number | null;
  last_tapped_at: string | null;
  habit: HabitSummary | null;
}

export interface BootstrapSyncResponse {
  synced_at: string;
  stickers: CachedSticker[];
  habits: HabitSummary[];
}

export interface ResolveOwnedActiveResponse {
  state: 'owned_active';
  sticker: { uuid: string; label: string | null };
  habit: HabitSummary;
  eligibility: {
    can_check_in: boolean;
    reason: string | null;
    next_available_at: string | null;
  };
}

export interface ResolveOwnedUnassignedResponse {
  state: 'owned_unassigned';
  sticker: { uuid: string; label: string | null };
}

export interface ResolveUnclaimedResponse {
  state: 'unclaimed';
  sticker: { uuid: string };
}

export interface ResolveTerminalErrorResponse {
  state: 'claimed_by_other' | 'disabled' | 'not_found';
  message: string;
}

export type StickerResolveResponse =
  | ResolveOwnedActiveResponse
  | ResolveOwnedUnassignedResponse
  | ResolveUnclaimedResponse
  | ResolveTerminalErrorResponse;

export type CheckInSource = 'universal_link' | 'foreground_nfc' | 'webhook';

export interface CheckInPayload {
  client_event_id: string;
  sticker_uuid: string;
  source: CheckInSource;
  tapped_at: string;
  hardware_uid?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CheckInResponse {
  idempotent_replay: boolean;
  check_in: {
    id: number;
    client_event_id: string;
    status: string;
    local_date: string;
    is_offline_sync: boolean;
    hardware_uid_verified: boolean;
    tapped_at: string;
  };
  habit: {
    id: number;
    name: string;
    current_streak: number;
    longest_streak: number;
  };
}
