import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { ApiError, apiRequest } from '../api/client';
import type { CheckInPayload, CheckInResponse } from '../api/types';
import { syncBootstrapCache } from './stickerCache';

const QUEUE_KEY = 'pending_check_in_queue_v1';

export interface PendingCheckIn extends CheckInPayload {
  local_photo_uri?: string | null;
  enqueued_at: string;
  attempts: number;
}

export interface FlushResult {
  synced: number;
  dropped: number;
  remaining: number;
}

type QueueListener = (count: number) => void;
const listeners = new Set<QueueListener>();
let flushInFlight: Promise<FlushResult> | null = null;
let queueClearedVersion = 0;

function notifyListeners(count: number): void {
  for (const listener of listeners) {
    listener(count);
  }
}

export async function getPendingCheckIns(): Promise<PendingCheckIn[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingCheckIn[];
  } catch {
    return [];
  }
}

async function saveQueue(items: PendingCheckIn[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  notifyListeners(items.length);
}

export async function enqueueCheckIn(
  payload: CheckInPayload,
  localPhotoUri?: string | null,
): Promise<PendingCheckIn[]> {
  const current = await getPendingCheckIns();
  const alreadyQueued = current.some(
    (item) => item.client_event_id === payload.client_event_id,
  );
  if (alreadyQueued) {
    return current;
  }

  const next: PendingCheckIn[] = [
    ...current,
    {
      ...payload,
      local_photo_uri: localPhotoUri ?? null,
      enqueued_at: new Date().toISOString(),
      attempts: 0,
    },
  ];
  await saveQueue(next);
  return next;
}

export async function findRecentQueuedTap(
  stickerUuid: string,
  cooldownMinutes: number,
  atIso: string,
): Promise<{ nextAvailableAt: string } | null> {
  if (cooldownMinutes <= 0) return null;

  const queue = await getPendingCheckIns();
  const atMs = new Date(atIso).getTime();
  const cooldownMs = cooldownMinutes * 60 * 1000;

  for (const item of queue) {
    if (item.sticker_uuid !== stickerUuid) continue;
    const itemMs = new Date(item.tapped_at).getTime();
    if (Number.isFinite(itemMs) && Math.abs(atMs - itemMs) < cooldownMs) {
      return {
        nextAvailableAt: new Date(itemMs + cooldownMs).toISOString(),
      };
    }
  }

  return null;
}

export async function clearCheckInQueue(): Promise<void> {
  queueClearedVersion += 1;
  await AsyncStorage.removeItem(QUEUE_KEY);
  notifyListeners(0);
}

function buildRequestBody(item: PendingCheckIn): CheckInPayload | FormData {
  if (!item.local_photo_uri) {
    return {
      client_event_id: item.client_event_id,
      sticker_uuid: item.sticker_uuid,
      source: item.source,
      tapped_at: item.tapped_at,
      hardware_uid: item.hardware_uid ?? null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
    };
  }

  const formData = new FormData();
  formData.append('client_event_id', item.client_event_id);
  formData.append('sticker_uuid', item.sticker_uuid);
  formData.append('source', item.source);
  formData.append('tapped_at', item.tapped_at);
  if (item.hardware_uid) {
    formData.append('hardware_uid', item.hardware_uid);
  }
  if (item.latitude !== null && item.latitude !== undefined) {
    formData.append('latitude', String(item.latitude));
  }
  if (item.longitude !== null && item.longitude !== undefined) {
    formData.append('longitude', String(item.longitude));
  }
  formData.append('photo', {
    uri: item.local_photo_uri,
    name: 'proof.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);

  return formData;
}

export async function flushCheckInQueue(): Promise<FlushResult> {
  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async (): Promise<FlushResult> => {
    const versionAtStart = queueClearedVersion;
    const snapshot = await getPendingCheckIns();
    if (snapshot.length === 0) {
      return { synced: 0, dropped: 0, remaining: 0 };
    }

    const sortedSnapshot = [...snapshot].sort(
      (a, b) => new Date(a.tapped_at).getTime() - new Date(b.tapped_at).getTime(),
    );

    const processedIds = new Set<string>();
    const retryById = new Map<string, PendingCheckIn>();
    let synced = 0;
    let dropped = 0;

    for (const item of sortedSnapshot) {
      if (queueClearedVersion !== versionAtStart) {
        return { synced, dropped, remaining: 0 };
      }

      try {
        await apiRequest<CheckInResponse>('/check-ins', {
          method: 'POST',
          body: buildRequestBody(item),
        });
        processedIds.add(item.client_event_id);
        synced += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Stop flushing immediately on 401; unauthorizedHandler manages session state
          break;
        }

        processedIds.add(item.client_event_id);

        if (error instanceof ApiError && !error.isNetworkError && error.status !== null) {
          if (error.status >= 400 && error.status < 500 && error.status !== 429) {
            dropped += 1;
            continue;
          }
        }

        retryById.set(item.client_event_id, {
          ...item,
          attempts: item.attempts + 1,
        });
      }
    }

    if (queueClearedVersion !== versionAtStart) {
      return { synced, dropped, remaining: 0 };
    }

    // Re-read storage so any check-ins enqueued while network I/O was in flight are preserved
    const latestStorage = await getPendingCheckIns();
    const merged: PendingCheckIn[] = [];

    for (const item of latestStorage) {
      if (!processedIds.has(item.client_event_id)) {
        merged.push(item);
      } else {
        const retryItem = retryById.get(item.client_event_id);
        if (retryItem) {
          merged.push(retryItem);
        }
      }
    }

    await saveQueue(merged);

    if (synced > 0) {
      await syncBootstrapCache().catch(() => {});
    }

    return { synced, dropped, remaining: merged.length };
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
}

export function usePendingCheckInCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    getPendingCheckIns().then((items) => {
      if (active) setCount(items.length);
    });

    const listener: QueueListener = (nextCount) => setCount(nextCount);
    listeners.add(listener);

    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  return count;
}

export function useOfflineQueueSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    flushCheckInQueue().catch(() => {});

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        flushCheckInQueue().catch(() => {});
      }
    });

    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        flushCheckInQueue().catch(() => {});
        syncBootstrapCache().catch(() => {});
      }
    });

    return () => {
      unsubscribeNetInfo();
      appStateSub.remove();
    };
  }, [enabled]);
}
