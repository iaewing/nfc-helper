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

export type VerificationType = 'tap' | 'tap_photo' | 'tap_photo_location';

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
