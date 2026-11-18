import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiError, apiRequest } from '../../src/api/client';
import type {
  CheckInPayload,
  CheckInResponse,
  HabitSummary,
  StickerResolveResponse,
} from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import {
  enqueueCheckIn,
  findRecentQueuedTap,
  flushCheckInQueue,
} from '../../src/offline/checkInQueue';
import {
  getCachedSticker,
  syncBootstrapCache,
} from '../../src/offline/stickerCache';

type ScreenState =
  | { kind: 'loading' }
  | {
      kind: 'verified';
      habitName: string;
      streak: number;
      replayed: boolean;
    }
  | {
      kind: 'queued_offline';
      habitName: string;
    }
  | {
      kind: 'needs_photo';
      habitName: string;
    }
  | {
      kind: 'needs_hardware_uid';
      habitName: string;
    }
  | {
      kind: 'cooldown';
      habitName: string;
      nextAvailableAt: string | null;
    }
  | {
      kind: 'unclaimed';
      uuid: string;
    }
  | {
      kind: 'unassigned';
      label: string | null;
    }
  | {
      kind: 'error';
      title: string;
      message: string;
    };

export default function StickerTapScreen() {
  const router = useRouter();
  const { uuid: rawUuid } = useLocalSearchParams<{ uuid?: string | string[] }>();
  const uuid = Array.isArray(rawUuid) ? rawUuid[0] : rawUuid;
  const { status } = useAuth();

  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [tapNonce, setTapNonce] = useState(0);
  const runIdRef = useRef(0);
  const initialTappedAtRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    initialTappedAtRef.current = new Date().toISOString();
  }, [uuid, tapNonce]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (uuid && url.includes(`/t/${uuid}`)) {
        setTapNonce((n) => n + 1);
      }
    });
    return () => subscription.remove();
  }, [uuid]);

  useEffect(() => {
    if (!uuid) {
      setScreen({
        kind: 'error',
        title: 'Invalid Sticker Link',
        message: 'No sticker identifier was found in this link.',
      });
      return;
    }

    if (status === 'loading') {
      return;
    }

    if (status === 'unauthenticated') {
      router.replace({
        pathname: '/(auth)/login',
        params: { redirect: `/t/${uuid}` },
      });
      return;
    }

    const currentRunId = ++runIdRef.current;
    const clientEventId = Crypto.randomUUID();
    const tappedAt = initialTappedAtRef.current;

    async function handleOfflineFallback(
      stickerUuid: string,
      basePayload: CheckInPayload,
      knownHabit: HabitSummary | null,
      lastTappedAt: string | null,
    ) {
      if (!knownHabit) {
        setScreen({
          kind: 'error',
          title: 'You Are Offline',
          message:
            'This sticker is not in your local cache yet. Reconnect and tap again to verify or claim it.',
        });
        return;
      }

      if (knownHabit.is_active === false) {
        setScreen({
          kind: 'error',
          title: knownHabit.name,
          message: 'This habit is currently paused.',
        });
        return;
      }

      if (knownHabit.cooldown_minutes > 0) {
        const cooldownMs = knownHabit.cooldown_minutes * 60 * 1000;
        const tappedMs = new Date(tappedAt).getTime();

        if (lastTappedAt) {
          const lastMs = new Date(lastTappedAt).getTime();
          if (Number.isFinite(lastMs) && Math.abs(tappedMs - lastMs) < cooldownMs) {
            setScreen({
              kind: 'cooldown',
              habitName: knownHabit.name,
              nextAvailableAt: new Date(lastMs + cooldownMs).toISOString(),
            });
            return;
          }
        }

        const recentQueued = await findRecentQueuedTap(
          stickerUuid,
          knownHabit.cooldown_minutes,
          tappedAt,
        );
        if (runIdRef.current !== currentRunId) return;

        if (recentQueued) {
          setScreen({
            kind: 'cooldown',
            habitName: knownHabit.name,
            nextAvailableAt: recentQueued.nextAvailableAt,
          });
          return;
        }
      }

      if (knownHabit.require_hardware_uid) {
        setScreen({
          kind: 'needs_hardware_uid',
          habitName: knownHabit.name,
        });
        return;
      }

      if (knownHabit.verification_type !== 'tap') {
        setScreen({
          kind: 'needs_photo',
          habitName: knownHabit.name,
        });
        return;
      }

      await enqueueCheckIn(basePayload);
      if (runIdRef.current !== currentRunId) return;

      setScreen({
        kind: 'queued_offline',
        habitName: knownHabit.name,
      });
    }

    async function processTap(stickerUuid: string) {
      setScreen({ kind: 'loading' });

      const basePayload: CheckInPayload = {
        client_event_id: clientEventId,
        sticker_uuid: stickerUuid,
        source: 'universal_link',
        tapped_at: tappedAt,
      };

      const cachedSticker = await getCachedSticker(stickerUuid);
      const netState = await NetInfo.fetch().catch(() => null);
      if (runIdRef.current !== currentRunId) return;

      if (netState && netState.isConnected === false) {
        await handleOfflineFallback(
          stickerUuid,
          basePayload,
          cachedSticker?.habit ?? null,
          cachedSticker?.last_tapped_at ?? null,
        );
        return;
      }

      let resolvedHabit: HabitSummary | null = cachedSticker?.habit ?? null;

      try {
        // Flush any earlier offline taps first so out-of-order conflicts don't occur
        await flushCheckInQueue().catch(() => {});

        const resolved = await apiRequest<StickerResolveResponse>(
          `/stickers/${encodeURIComponent(stickerUuid)}/resolve`,
          { timeoutMs: cachedSticker ? 4000 : 8000 },
        );

        if (runIdRef.current !== currentRunId) return;

        if (resolved.state === 'unclaimed') {
          setScreen({ kind: 'unclaimed', uuid: stickerUuid });
          return;
        }

        if (resolved.state === 'owned_unassigned') {
          setScreen({ kind: 'unassigned', label: resolved.sticker.label });
          return;
        }

        if (resolved.state !== 'owned_active') {
          setScreen({
            kind: 'error',
            title: 'Sticker Unavailable',
            message: resolved.message,
          });
          return;
        }

        resolvedHabit = resolved.habit;

        if (!resolved.eligibility.can_check_in) {
          if (resolved.eligibility.reason === 'COOLDOWN_ACTIVE') {
            setScreen({
              kind: 'cooldown',
              habitName: resolved.habit.name,
              nextAvailableAt: resolved.eligibility.next_available_at,
            });
            return;
          }

          setScreen({
            kind: 'error',
            title: resolved.habit.name,
            message:
              resolved.eligibility.reason === 'OUTSIDE_SCHEDULE_WINDOW'
                ? 'This tap is outside the configured schedule window.'
                : 'This habit cannot be checked in right now.',
          });
          return;
        }

        if (resolved.habit.require_hardware_uid) {
          setScreen({
            kind: 'needs_hardware_uid',
            habitName: resolved.habit.name,
          });
          return;
        }

        if (resolved.habit.verification_type !== 'tap') {
          setScreen({
            kind: 'needs_photo',
            habitName: resolved.habit.name,
          });
          return;
        }

        const checkIn = await apiRequest<CheckInResponse>('/check-ins', {
          method: 'POST',
          body: basePayload,
        });

        if (runIdRef.current !== currentRunId) return;

        syncBootstrapCache().catch(() => {});

        setScreen({
          kind: 'verified',
          habitName: checkIn.habit.name,
          streak: checkIn.habit.current_streak,
          replayed: checkIn.idempotent_replay,
        });
      } catch (error) {
        if (runIdRef.current !== currentRunId) return;

        if (error instanceof ApiError && error.isNetworkError) {
          const latestCached = cachedSticker ?? (await getCachedSticker(stickerUuid));
          if (runIdRef.current !== currentRunId) return;

          await handleOfflineFallback(
            stickerUuid,
            basePayload,
            resolvedHabit ?? latestCached?.habit ?? null,
            latestCached?.last_tapped_at ?? null,
          );
          return;
        }

        if (error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE') {
          setScreen({
            kind: 'cooldown',
            habitName: resolvedHabit?.name ?? 'Habit Check-In',
            nextAvailableAt:
              typeof error.meta?.next_available_at === 'string'
                ? error.meta.next_available_at
                : null,
          });
          return;
        }

        setScreen({
          kind: 'error',
          title: 'Verification Failed',
          message:
            error instanceof ApiError
              ? error.message
              : 'Something went wrong while verifying this sticker.',
        });
      }
    }

    processTap(uuid);
  }, [uuid, status, router, tapNonce]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {screen.kind === 'loading' ? (
          <>
            <ActivityIndicator size="large" color="#38BDF8" />
            <Text style={styles.title}>Verifying Sticker…</Text>
            <Text style={styles.body}>Checking your habit and streak status.</Text>
          </>
        ) : null}

        {screen.kind === 'verified' ? (
          <>
            <Text style={styles.successBadge}>PROVED IT</Text>
            <Text style={styles.title}>{screen.habitName}</Text>
            <Text style={styles.streakText}>
              {screen.streak} day streak
            </Text>
            <Text style={styles.body}>
              {screen.replayed
                ? 'This tap was already recorded.'
                : 'Physical presence verified and logged.'}
            </Text>
          </>
        ) : null}

        {screen.kind === 'queued_offline' ? (
          <>
            <Text style={styles.offlineBadge}>SAVED OFFLINE</Text>
            <Text style={styles.title}>{screen.habitName}</Text>
            <Text style={styles.body}>
              Your tap timestamp was captured and queued locally. It will sync automatically once you are back online.
            </Text>
          </>
        ) : null}

        {screen.kind === 'needs_photo' ? (
          <>
            <Text style={styles.infoBadge}>LIVE PHOTO REQUIRED</Text>
            <Text style={styles.title}>{screen.habitName}</Text>
            <Text style={styles.body}>
              This habit requires a live photo proof via expo-camera (wired in Phase 3).
            </Text>
          </>
        ) : null}

        {screen.kind === 'needs_hardware_uid' ? (
          <>
            <Text style={styles.infoBadge}>HARDWARE VERIFICATION</Text>
            <Text style={styles.title}>{screen.habitName}</Text>
            <Text style={styles.body}>
              High-security mode is enabled on this habit. Hold your phone to the sticker again for a foreground NFC chip check (wired in Phase 3).
            </Text>
          </>
        ) : null}

        {screen.kind === 'cooldown' ? (
          <>
            <Text style={styles.offlineBadge}>COOLDOWN ACTIVE</Text>
            <Text style={styles.title}>{screen.habitName}</Text>
            <Text style={styles.body}>
              {screen.nextAvailableAt
                ? `Already checked in recently. Next check-in available at ${new Date(screen.nextAvailableAt).toLocaleTimeString()}.`
                : 'Already checked in recently. Try again after the cooldown window.'}
            </Text>
          </>
        ) : null}

        {screen.kind === 'unclaimed' ? (
          <>
            <Text style={styles.infoBadge}>NEW STICKER</Text>
            <Text style={styles.title}>Unclaimed Prove It Sticker</Text>
            <Text style={styles.body}>
              This sticker is ready to claim. Foreground NFC claiming will bind its 7-byte hardware UID to your account in Phase 3.
            </Text>
          </>
        ) : null}

        {screen.kind === 'unassigned' ? (
          <>
            <Text style={styles.infoBadge}>UNASSIGNED STICKER</Text>
            <Text style={styles.title}>{screen.label ?? 'Your Sticker'}</Text>
            <Text style={styles.body}>
              You own this sticker, but it is not linked to a habit yet.
            </Text>
          </>
        ) : null}

        {screen.kind === 'error' ? (
          <>
            <Text style={styles.errorBadge}>UNABLE TO VERIFY</Text>
            <Text style={styles.title}>{screen.title}</Text>
            <Text style={styles.body}>{screen.message}</Text>
          </>
        ) : null}

        <Pressable
          style={[
            styles.button,
            screen.kind === 'loading' && styles.secondaryButton,
          ]}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text
            style={[
              styles.buttonText,
              screen.kind === 'loading' && styles.secondaryButtonText,
            ]}
          >
            {screen.kind === 'loading' ? 'Cancel' : 'Back to Habits'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 28,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  successBadge: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  offlineBadge: {
    color: '#FACC15',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  infoBadge: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  errorBadge: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  streakText: {
    color: '#38BDF8',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  body: {
    color: '#CBD5E1',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#334155',
  },
  buttonText: {
    color: '#082F49',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#E2E8F0',
  },
});
