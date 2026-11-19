import NetInfo from '@react-native-community/netinfo';
import { CameraView, type CameraType, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiError, apiRequest } from '../../src/api/client';
import type {
  CheckInPayload,
  CheckInResponse,
  CheckInSource,
  HabitSummary,
  StickerResolveResponse,
} from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import { NfcScanError, useNfcScanner } from '../../src/nfc/useNfcScanner';
import {
  enqueueCheckIn,
  findRecentQueuedTap,
  flushCheckInQueue,
} from '../../src/offline/checkInQueue';
import {
  getCachedSticker,
  markStickerTappedLocally,
  syncBootstrapCache,
} from '../../src/offline/stickerCache';

interface VerificationSession {
  clientEventId: string;
  stickerUuid: string;
  tappedAt: string;
  habit: HabitSummary;
  source: CheckInSource;
  hardwareUid: string | null;
  latitude: number | null;
  longitude: number | null;
  photoUri: string | null;
}

type ScreenState =
  | { kind: 'loading'; label?: string }
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
      kind: 'needs_hardware_uid';
      session: VerificationSession;
      stepError?: string | null;
    }
  | {
      kind: 'needs_location';
      session: VerificationSession;
      fetching: boolean;
      stepError?: string | null;
    }
  | {
      kind: 'needs_photo';
      session: VerificationSession;
      stepError?: string | null;
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
      uuid: string;
      label: string | null;
    }
  | {
      kind: 'error';
      title: string;
      message: string;
    };

function habitRequiresPhoto(habit: HabitSummary): boolean {
  return (
    habit.verification_type === 'tap_photo' ||
    habit.verification_type === 'tap_photo_location'
  );
}

function habitRequiresLocation(habit: HabitSummary): boolean {
  return (
    habit.verification_type === 'tap_location' ||
    habit.verification_type === 'tap_photo_location'
  );
}

function buildCheckInBody(session: VerificationSession): CheckInPayload | FormData {
  if (!session.photoUri) {
    return {
      client_event_id: session.clientEventId,
      sticker_uuid: session.stickerUuid,
      source: session.source,
      tapped_at: session.tappedAt,
      hardware_uid: session.hardwareUid,
      latitude: session.latitude,
      longitude: session.longitude,
    };
  }

  const formData = new FormData();
  formData.append('client_event_id', session.clientEventId);
  formData.append('sticker_uuid', session.stickerUuid);
  formData.append('source', session.source);
  formData.append('tapped_at', session.tappedAt);

  if (session.hardwareUid) {
    formData.append('hardware_uid', session.hardwareUid);
  }
  if (session.latitude !== null) {
    formData.append('latitude', String(session.latitude));
  }
  if (session.longitude !== null) {
    formData.append('longitude', String(session.longitude));
  }

  formData.append('photo', {
    uri: session.photoUri,
    name: 'proof.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);

  return formData;
}

export default function StickerTapScreen() {
  const router = useRouter();
  const { uuid: rawUuid } = useLocalSearchParams<{ uuid?: string | string[] }>();
  const uuid = Array.isArray(rawUuid) ? rawUuid[0] : rawUuid;
  const { status } = useAuth();

  const {
    isScanning,
    scanTag,
    cancelScan,
    clearError: clearNfcError,
  } = useNfcScanner();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [previewPhotoUri, setPreviewPhotoUri] = useState<string | null>(null);

  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [tapNonce, setTapNonce] = useState(0);
  const runIdRef = useRef(0);
  const initialTappedAtRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    initialTappedAtRef.current = new Date().toISOString();
    setPreviewPhotoUri(null);
    setCameraReady(false);
  }, [uuid, tapNonce]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (uuid && url.includes(`/t/${uuid}`)) {
        cancelScan().catch(() => {});
        setTapNonce((n) => n + 1);
      }
    });
    return () => subscription.remove();
  }, [uuid, cancelScan]);

  const submitSession = useCallback(
    async (session: VerificationSession, expectedRunId: number) => {
      setScreen({
        kind: 'loading',
        label: session.photoUri ? 'Uploading Photo Proof…' : 'Recording Check-In…',
      });

      try {
        const checkIn = await apiRequest<CheckInResponse>('/check-ins', {
          method: 'POST',
          body: buildCheckInBody(session),
          timeoutMs: session.photoUri ? 20000 : 10000,
        });

        if (runIdRef.current !== expectedRunId) return;

        await markStickerTappedLocally(
          session.stickerUuid,
          checkIn.check_in.tapped_at,
          checkIn.habit.current_streak,
        ).catch(() => {});
        syncBootstrapCache().catch(() => {});

        setScreen({
          kind: 'verified',
          habitName: checkIn.habit.name,
          streak: checkIn.habit.current_streak,
          replayed: checkIn.idempotent_replay,
        });
      } catch (error) {
        if (runIdRef.current !== expectedRunId) return;

        if (error instanceof ApiError && error.code === 'COOLDOWN_ACTIVE') {
          setScreen({
            kind: 'cooldown',
            habitName: session.habit.name,
            nextAvailableAt:
              typeof error.meta?.next_available_at === 'string'
                ? error.meta.next_available_at
                : null,
          });
          return;
        }

        if (error instanceof ApiError && error.code === 'OUTSIDE_GEOFENCE') {
          const distance = error.meta?.distance_meters;
          const allowed = error.meta?.allowed_radius_meters;
          const detail =
            typeof distance === 'number' && typeof allowed === 'number'
              ? `You are ${distance}m away (allowed radius: ${allowed}m). Move closer and try again.`
              : error.message;

          setScreen({
            kind: 'needs_location',
            session: { ...session, latitude: null, longitude: null },
            fetching: false,
            stepError: detail,
          });
          return;
        }

        if (error instanceof ApiError && error.code === 'HARDWARE_UID_MISMATCH') {
          setScreen({
            kind: 'needs_hardware_uid',
            session: { ...session, hardwareUid: null, source: 'universal_link' },
            stepError: error.message,
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
    },
    [],
  );

  const captureLocationForSession = useCallback(
    async (session: VerificationSession, expectedRunId: number) => {
      setScreen({
        kind: 'needs_location',
        session,
        fetching: true,
        stepError: null,
      });

      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (runIdRef.current !== expectedRunId) return;

        if (permission.status !== 'granted') {
          setScreen({
            kind: 'needs_location',
            session,
            fetching: false,
            stepError:
              'Foreground location permission is required to verify your geofence.',
          });
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (runIdRef.current !== expectedRunId) return;

        const nextSession: VerificationSession = {
          ...session,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        if (habitRequiresPhoto(nextSession.habit) && !nextSession.photoUri) {
          setPreviewPhotoUri(null);
          setCameraReady(false);
          setScreen({ kind: 'needs_photo', session: nextSession, stepError: null });
          return;
        }

        await submitSession(nextSession, expectedRunId);
      } catch {
        if (runIdRef.current !== expectedRunId) return;
        setScreen({
          kind: 'needs_location',
          session,
          fetching: false,
          stepError: 'Unable to determine your GPS location. Please try again.',
        });
      }
    },
    [submitSession],
  );

  const advanceSession = useCallback(
    async (session: VerificationSession, expectedRunId: number) => {
      if (session.habit.require_hardware_uid && !session.hardwareUid) {
        setScreen({
          kind: 'needs_hardware_uid',
          session,
          stepError: null,
        });
        return;
      }

      if (
        habitRequiresLocation(session.habit) &&
        (session.latitude === null || session.longitude === null)
      ) {
        await captureLocationForSession(session, expectedRunId);
        return;
      }

      if (habitRequiresPhoto(session.habit) && !session.photoUri) {
        setPreviewPhotoUri(null);
        setCameraReady(false);
        setScreen({ kind: 'needs_photo', session, stepError: null });
        return;
      }

      await submitSession(session, expectedRunId);
    },
    [captureLocationForSession, submitSession],
  );

  const handleHardwareUidScan = async () => {
    if (screen.kind !== 'needs_hardware_uid') return;
    const expectedRunId = runIdRef.current;
    const currentSession = screen.session;
    clearNfcError();

    setScreen({
      kind: 'needs_hardware_uid',
      session: currentSession,
      stepError: null,
    });

    try {
      const result = await scanTag({
        alertMessage: `Hold your phone to the "${currentSession.habit.name}" sticker to verify its chip.`,
      });

      if (runIdRef.current !== expectedRunId) return;

      if (result.uuid.toLowerCase() !== currentSession.stickerUuid.toLowerCase()) {
        setScreen({
          kind: 'needs_hardware_uid',
          session: currentSession,
          stepError:
            'You scanned a different sticker. Hold your phone to the sticker linked to this habit.',
        });
        return;
      }

      const nextSession: VerificationSession = {
        ...currentSession,
        hardwareUid: result.hardwareUid,
        source: 'foreground_nfc',
      };

      await advanceSession(nextSession, expectedRunId);
    } catch (err) {
      if (runIdRef.current !== expectedRunId) return;
      if (err instanceof NfcScanError && err.code === 'USER_CANCELLED') {
        return;
      }
      setScreen({
        kind: 'needs_hardware_uid',
        session: currentSession,
        stepError:
          err instanceof Error
            ? err.message
            : 'Unable to read NFC hardware UID. Try again.',
      });
    }
  };

  const handleTakePhoto = async () => {
    if (screen.kind !== 'needs_photo' || !cameraRef.current || capturingPhoto) {
      return;
    }

    setCapturingPhoto(true);
    try {
      const captured = await cameraRef.current.takePictureAsync({
        quality: 0.65,
        skipProcessing: false,
      });
      setPreviewPhotoUri(captured.uri);
      setScreen({
        kind: 'needs_photo',
        session: screen.session,
        stepError: null,
      });
    } catch {
      setScreen({
        kind: 'needs_photo',
        session: screen.session,
        stepError: 'Could not capture photo. Please try again.',
      });
    } finally {
      setCapturingPhoto(false);
    }
  };

  const handleConfirmPhoto = async () => {
    if (screen.kind !== 'needs_photo' || !previewPhotoUri) return;
    const expectedRunId = runIdRef.current;
    const nextSession: VerificationSession = {
      ...screen.session,
      photoUri: previewPhotoUri,
    };
    await submitSession(nextSession, expectedRunId);
  };

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
          knownHabit.id,
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

      if (knownHabit.require_hardware_uid || knownHabit.verification_type !== 'tap') {
        setScreen({
          kind: 'error',
          title: 'Connection Required',
          message:
            'This habit requires additional verification (hardware chip, live photo, or geofence) that cannot be completed while offline.',
        });
        return;
      }

      await enqueueCheckIn(basePayload, null, knownHabit.id);
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
          setScreen({
            kind: 'unassigned',
            uuid: stickerUuid,
            label: resolved.sticker.label,
          });
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
                : resolved.eligibility.reason === 'HABIT_INACTIVE'
                  ? 'This habit is currently paused.'
                  : 'This habit cannot be checked in right now.',
          });
          return;
        }

        const session: VerificationSession = {
          clientEventId,
          stickerUuid,
          tappedAt,
          habit: resolved.habit,
          source: 'universal_link',
          hardwareUid: null,
          latitude: null,
          longitude: null,
          photoUri: null,
        };

        if (
          resolved.habit.require_hardware_uid ||
          resolved.habit.verification_type !== 'tap'
        ) {
          await advanceSession(session, currentRunId);
          return;
        }

        const checkIn = await apiRequest<CheckInResponse>('/check-ins', {
          method: 'POST',
          body: basePayload,
        });

        if (runIdRef.current !== currentRunId) return;

        await markStickerTappedLocally(
          stickerUuid,
          checkIn.check_in.tapped_at,
          checkIn.habit.current_streak,
        ).catch(() => {});
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
  }, [uuid, status, router, tapNonce, advanceSession]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <View style={styles.card}>
        {screen.kind === 'loading' ? (
          <>
            <ActivityIndicator size="large" color="#38BDF8" />
            <Text style={styles.title}>{screen.label ?? 'Verifying Sticker…'}</Text>
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

        {screen.kind === 'needs_hardware_uid' ? (
          <>
            <Text style={styles.infoBadge}>HARDWARE VERIFICATION</Text>
            <Text style={styles.title}>{screen.session.habit.name}</Text>
            <Text style={styles.body}>
              High-security mode is enabled on this habit. Hold your phone against the sticker to verify its 7-byte NTAG213/215 hardware chip.
            </Text>

            {screen.stepError ? (
              <View style={styles.stepErrorBox}>
                <Text style={styles.stepErrorText}>{screen.stepError}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryActionButton, isScanning && styles.buttonDisabled]}
              onPress={handleHardwareUidScan}
              disabled={isScanning}
            >
              {isScanning ? (
                <ActivityIndicator color="#082F49" />
              ) : (
                <Text style={styles.buttonText}>Scan Sticker Chip Now</Text>
              )}
            </Pressable>
          </>
        ) : null}

        {screen.kind === 'needs_location' ? (
          <>
            <Text style={styles.infoBadge}>LOCATION GEOFENCE</Text>
            <Text style={styles.title}>{screen.session.habit.name}</Text>
            {screen.fetching ? (
              <>
                <ActivityIndicator size="large" color="#38BDF8" style={styles.stepSpinner} />
                <Text style={styles.body}>
                  Checking your current GPS location against the habit geofence…
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.body}>
                  This habit verifies that you are physically within its configured geofence.
                </Text>
                {screen.stepError ? (
                  <View style={styles.stepErrorBox}>
                    <Text style={styles.stepErrorText}>{screen.stepError}</Text>
                  </View>
                ) : null}
                <Pressable
                  style={styles.primaryActionButton}
                  onPress={() =>
                    captureLocationForSession(screen.session, runIdRef.current)
                  }
                >
                  <Text style={styles.buttonText}>Verify Current Location</Text>
                </Pressable>
              </>
            )}
          </>
        ) : null}

        {screen.kind === 'needs_photo' ? (
          <>
            <Text style={styles.infoBadge}>LIVE PHOTO PROOF</Text>
            <Text style={styles.title}>{screen.session.habit.name}</Text>
            <Text style={styles.body}>
              Take a live photo right now to prove completion. Photo library uploads are disabled.
            </Text>

            {screen.stepError ? (
              <View style={styles.stepErrorBox}>
                <Text style={styles.stepErrorText}>{screen.stepError}</Text>
              </View>
            ) : null}

            {!cameraPermission?.granted ? (
              <Pressable
                style={styles.primaryActionButton}
                onPress={() => requestCameraPermission()}
              >
                <Text style={styles.buttonText}>Allow Camera Access</Text>
              </Pressable>
            ) : previewPhotoUri ? (
              <View style={styles.cameraContainer}>
                <Image
                  source={{ uri: previewPhotoUri }}
                  style={styles.cameraPreview}
                  resizeMode="cover"
                />
                <View style={styles.photoActionRow}>
                  <Pressable
                    style={styles.retakeButton}
                    onPress={() => {
                      setCameraReady(false);
                      setPreviewPhotoUri(null);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Retake</Text>
                  </Pressable>
                  <Pressable
                    style={styles.confirmPhotoButton}
                    onPress={handleConfirmPhoto}
                  >
                    <Text style={styles.confirmPhotoText}>Submit Proof</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.cameraContainer}>
                <CameraView
                  ref={cameraRef}
                  style={styles.cameraPreview}
                  facing={cameraFacing}
                  onCameraReady={() => setCameraReady(true)}
                />
                <View style={styles.photoActionRow}>
                  <Pressable
                    style={styles.retakeButton}
                    onPress={() =>
                      setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'))
                    }
                  >
                    <Text style={styles.secondaryButtonText}>Flip</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.confirmPhotoButton,
                      (!cameraReady || capturingPhoto) && styles.buttonDisabled,
                    ]}
                    onPress={handleTakePhoto}
                    disabled={!cameraReady || capturingPhoto}
                  >
                    {capturingPhoto ? (
                      <ActivityIndicator color="#082F49" />
                    ) : (
                      <Text style={styles.buttonText}>Capture Photo</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
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
              This sticker is ready to claim. Scan it in the foreground to bind its 7-byte hardware UID to your account and assign a habit.
            </Text>
            <Pressable
              style={styles.primaryActionButton}
              onPress={() =>
                router.replace({
                  pathname: '/stickers/claim',
                  params: { uuid: screen.uuid },
                })
              }
            >
              <Text style={styles.buttonText}>Claim This Sticker</Text>
            </Pressable>
          </>
        ) : null}

        {screen.kind === 'unassigned' ? (
          <>
            <Text style={styles.infoBadge}>UNASSIGNED STICKER</Text>
            <Text style={styles.title}>{screen.label ?? 'Your Sticker'}</Text>
            <Text style={styles.body}>
              You own this sticker, but it is not linked to a habit yet.
            </Text>
            <Pressable
              style={styles.primaryActionButton}
              onPress={() => router.replace(`/stickers/${screen.uuid}`)}
            >
              <Text style={styles.buttonText}>Assign a Habit</Text>
            </Pressable>
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
            (screen.kind === 'loading' ||
              screen.kind === 'needs_hardware_uid' ||
              screen.kind === 'needs_location' ||
              screen.kind === 'needs_photo' ||
              screen.kind === 'unclaimed' ||
              screen.kind === 'unassigned') &&
              styles.secondaryButton,
          ]}
          onPress={() => {
            cancelScan().catch(() => {});
            router.replace('/(tabs)');
          }}
        >
          <Text
            style={[
              styles.buttonText,
              (screen.kind === 'loading' ||
                screen.kind === 'needs_hardware_uid' ||
                screen.kind === 'needs_location' ||
                screen.kind === 'needs_photo' ||
                screen.kind === 'unclaimed' ||
                screen.kind === 'unassigned') &&
                styles.secondaryButtonText,
            ]}
          >
            {screen.kind === 'loading' ? 'Cancel' : 'Back to Habits'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 24,
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
    marginBottom: 20,
  },
  stepSpinner: {
    marginVertical: 14,
  },
  stepErrorBox: {
    backgroundColor: '#450A0A',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 16,
  },
  stepErrorText: {
    color: '#FECACA',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  cameraContainer: {
    width: '100%',
    marginBottom: 16,
    gap: 12,
  },
  cameraPreview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#020617',
  },
  photoActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  retakeButton: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPhotoButton: {
    flex: 1,
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPhotoText: {
    color: '#082F49',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryActionButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#082F49',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
  },
});
