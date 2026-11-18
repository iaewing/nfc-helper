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

export async function clearCheckInQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
  notifyListeners(0);
}

export async function flushCheckInQueue(): Promise<FlushResult> {
  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async (): Promise<FlushResult> => {
    const queue = await getPendingCheckIns();
    if (queue.length === 0) {
      return { synced: 0, dropped: 0, remaining: 0 };
    }

    const remaining: PendingCheckIn[] = [];
    let synced = 0;
    let dropped = 0;

    for (const item of queue) {
      try {
        const body: CheckInPayload = {
          client_event_id: item.client_event_id,
          sticker_uuid: item.sticker_uuid,
          source: item.source,
          tapped_at: item.tapped_at,
          hardware_uid: item.hardware_uid ?? null,
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
        };

        await apiRequest<CheckInResponse>('/check-ins', {
          method: 'POST',
          body,
        });
        synced += 1;
      } catch (error) {
        if (error instanceof ApiError && !error.isNetworkError && error.status !== null) {
          if (error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
            // Permanent client/domain rejection (e.g. cooldown or expired offline window)
            dropped += 1;
            continue;
          }
        }

        remaining.push({
          ...item,
          attempts: item.attempts + 1,
        });
      }
    }

    await saveQueue(remaining);

    if (synced > 0) {
      await syncBootstrapCache().catch(() => {});
    }

    return { synced, dropped, remaining: remaining.length };
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
