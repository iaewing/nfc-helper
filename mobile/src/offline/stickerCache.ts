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

export async function clearBootstrapCache(): Promise<void> {
  await AsyncStorage.removeItem(BOOTSTRAP_CACHE_KEY);
}
