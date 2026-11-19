import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../api/client';
import type { BootstrapSyncResponse, CachedSticker, HabitSummary } from '../api/types';

const BOOTSTRAP_CACHE_KEY = 'bootstrap_sync_cache_v1';

interface StoredBootstrap {
  syncedAt: string;
  stickersByUuid: Record<string, CachedSticker>;
  habits: HabitSummary[];
}

export async function syncBootstrapCache(): Promise<StoredBootstrap> {
  const response = await apiRequest<BootstrapSyncResponse>('/sync/bootstrap');

  const stickersByUuid: Record<string, CachedSticker> = {};
  for (const sticker of response.stickers) {
    stickersByUuid[sticker.uuid] = sticker;
  }

  const stored: StoredBootstrap = {
    syncedAt: response.synced_at,
    stickersByUuid,
    habits: response.habits,
  };

  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(stored));
  return stored;
}

export async function getBootstrapCache(): Promise<StoredBootstrap | null> {
  const raw = await AsyncStorage.getItem(BOOTSTRAP_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredBootstrap;
  } catch {
    return null;
  }
}

export async function getCachedSticker(uuid: string): Promise<CachedSticker | null> {
  const cache = await getBootstrapCache();
  return cache?.stickersByUuid[uuid] ?? null;
}

export async function markStickerTappedLocally(
  uuid: string,
  tappedAt: string,
  newStreak?: number,
): Promise<void> {
  const cache = await getBootstrapCache();
  if (!cache) return;

  const sticker = cache.stickersByUuid[uuid];
  if (!sticker) return;

  const prevMs = sticker.last_tapped_at
    ? new Date(sticker.last_tapped_at).getTime()
    : 0;
  const nextMs = new Date(tappedAt).getTime();

  if (!Number.isFinite(prevMs) || nextMs >= prevMs) {
    sticker.last_tapped_at = tappedAt;
  }

  if (sticker.habit && typeof newStreak === 'number') {
    sticker.habit.current_streak = newStreak;
    cache.habits = cache.habits.map((h) =>
      h.id === sticker.habit?.id ? { ...h, current_streak: newStreak } : h,
    );
  }

  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(cache));
}

export async function clearBootstrapCache(): Promise<void> {
  await AsyncStorage.removeItem(BOOTSTRAP_CACHE_KEY);
}
