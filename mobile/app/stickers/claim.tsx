import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError, apiRequest } from '../../src/api/client';
import type {
  Habit,
  HabitMutationResponse,
  HabitPayload,
  HabitsListResponse,
  StickerResponse,
} from '../../src/api/types';
import { formatVerificationLabel, HabitForm } from '../../src/components/HabitForm';
import {
  NfcScanError,
  type NfcScanResult,
  useNfcScanner,
} from '../../src/nfc/useNfcScanner';
import { syncBootstrapCache } from '../../src/offline/stickerCache';

export default function ClaimStickerScreen() {
  const router = useRouter();
  const { uuid: rawExpectedUuid } = useLocalSearchParams<{
    uuid?: string | string[];
  }>();
  const expectedUuid = (
    Array.isArray(rawExpectedUuid) ? rawExpectedUuid[0] : rawExpectedUuid
  )?.toLowerCase();

  const { isScanning, error: nfcError, clearError, scanTag, cancelScan } =
    useNfcScanner();

  const [scanned, setScanned] = useState<NfcScanResult | null>(null);
  const [label, setLabel] = useState('');
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loadingHabits, setLoadingHabits] = useState(true);
  const [selectedHabitId, setSelectedHabitId] = useState<number | null>(null);
  const [creatingInlineHabit, setCreatingInlineHabit] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadHabits = useCallback(async () => {
    setLoadingHabits(true);
    try {
      const response = await apiRequest<HabitsListResponse>('/habits');
      setHabits(response.habits);
    } catch {
      // Keep empty list if offline; claiming itself requires network
    } finally {
      setLoadingHabits(false);
    }
  }, []);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  const handleStartScan = async () => {
    setSubmitError(null);
    clearError();
    try {
      const result = await scanTag({
        alertMessage: 'Hold your phone to the Prove It sticker to claim it.',
      });
      setScanned(result);
    } catch (err) {
      if (err instanceof NfcScanError && err.code === 'USER_CANCELLED') {
        return;
      }
      // nfcError state is populated by the hook
    }
  };

  const handleInlineHabitCreated = async (payload: HabitPayload) => {
    const response = await apiRequest<HabitMutationResponse>('/habits', {
      method: 'POST',
      body: payload,
    });
    setHabits((prev) => [...prev, response.habit]);
    setSelectedHabitId(response.habit.id);
    setCreatingInlineHabit(false);
  };

  const handleClaim = async () => {
    if (!scanned) {
      setSubmitError('Scan the physical NFC sticker first to read its hardware UID.');
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiRequest<StickerResponse>('/stickers/claim', {
        method: 'POST',
        body: {
          uuid: scanned.uuid,
          hardware_uid: scanned.hardwareUid,
          label: label.trim() ? label.trim() : null,
          habit_id: selectedHabitId,
        },
      });

      await syncBootstrapCache().catch(() => {});
      router.replace('/(tabs)/stickers');
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Unable to claim this sticker. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const uuidMismatch =
    Boolean(expectedUuid) &&
    scanned !== null &&
    scanned.uuid.toLowerCase() !== expectedUuid;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.stepBadge}>STEP 1 · HARDWARE SCAN</Text>
          <Text style={styles.cardTitle}>Scan Physical Sticker</Text>
          <Text style={styles.cardBody}>
            Claiming requires a foreground NFC scan to permanently bind the sticker&apos;s
            7-byte NTAG213/215 hardware UID to your account.
          </Text>

          {expectedUuid && !scanned ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoBoxText}>
                Ready to claim tapped sticker: {expectedUuid}
              </Text>
            </View>
          ) : null}

          {nfcError && nfcError.code !== 'USER_CANCELLED' ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorCode}>{nfcError.code}</Text>
              <Text style={styles.errorText}>{nfcError.message}</Text>
            </View>
          ) : null}

          {scanned ? (
            <View style={styles.scannedBox}>
              <Text style={styles.scannedTitle}>Sticker Detected</Text>
              <Text style={styles.monoLabel}>UUID</Text>
              <Text style={styles.monoValue}>{scanned.uuid}</Text>
              <Text style={styles.monoLabel}>7-Byte Hardware UID</Text>
              <Text style={styles.monoValue}>{scanned.hardwareUid}</Text>

              {uuidMismatch ? (
                <Text style={styles.warningText}>
                  Note: Scanned sticker UUID differs from the link you originally tapped.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.scanButtonRow}>
            <Pressable
              style={[styles.primaryButton, isScanning && styles.buttonDisabled]}
              onPress={handleStartScan}
              disabled={isScanning}
            >
              {isScanning ? (
                <ActivityIndicator color="#082F49" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {scanned ? 'Re-Scan Sticker' : 'Scan Sticker via NFC'}
                </Text>
              )}
            </Pressable>

            {isScanning ? (
              <Pressable style={styles.cancelScanButton} onPress={cancelScan}>
                <Text style={styles.cancelScanText}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.stepBadge}>STEP 2 · LABEL & HABIT</Text>
          <Text style={styles.cardTitle}>Configure Sticker</Text>

          <Text style={styles.label}>Sticker Label (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Coffee Maker, Gym Bag, Front Door"
            placeholderTextColor="#64748B"
            value={label}
            onChangeText={setLabel}
            maxLength={100}
          />

          <View style={styles.habitHeaderRow}>
            <Text style={styles.label}>Assign to Habit</Text>
            <Pressable
              onPress={() => setCreatingInlineHabit((prev) => !prev)}
            >
              <Text style={styles.inlineLink}>
                {creatingInlineHabit ? 'Close New Habit' : '+ Create New Habit'}
              </Text>
            </Pressable>
          </View>

          {creatingInlineHabit ? (
            <View style={styles.inlineFormWrap}>
              <HabitForm
                submitLabel="Save & Select Habit"
                onSubmit={handleInlineHabitCreated}
              />
            </View>
          ) : loadingHabits ? (
            <ActivityIndicator color="#38BDF8" style={styles.loader} />
          ) : (
            <View style={styles.habitList}>
              <Pressable
                style={[
                  styles.habitOption,
                  selectedHabitId === null && styles.habitOptionSelected,
                ]}
                onPress={() => setSelectedHabitId(null)}
              >
                <Text style={styles.habitOptionTitle}>Leave Unassigned</Text>
                <Text style={styles.habitOptionMeta}>
                  Claim now and link to a habit later
                </Text>
              </Pressable>

              {habits.map((habit) => {
                const selected = selectedHabitId === habit.id;
                return (
                  <Pressable
                    key={habit.id}
                    style={[
                      styles.habitOption,
                      selected && styles.habitOptionSelected,
                    ]}
                    onPress={() => setSelectedHabitId(habit.id)}
                  >
                    <Text style={styles.habitOptionTitle}>
                      {habit.icon ? `${habit.icon} ` : ''}
                      {habit.name}
                    </Text>
                    <Text style={styles.habitOptionMeta}>
                      {formatVerificationLabel(habit.verification_type)}
                      {habit.require_hardware_uid ? ' · Chip Check' : ''}
                      {!habit.is_active ? ' · Paused' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {submitError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        ) : null}

        <Pressable
          style={[
            styles.claimButton,
            (!scanned || submitting || creatingInlineHabit) && styles.buttonDisabled,
          ]}
          onPress={handleClaim}
          disabled={!scanned || submitting || creatingInlineHabit}
        >
          {submitting ? (
            <ActivityIndicator color="#052E16" />
          ) : (
            <Text style={styles.claimButtonText}>Claim Sticker</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 44,
    gap: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  stepBadge: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  cardBody: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
  },
  infoBox: {
    backgroundColor: '#0C4A6E',
    borderRadius: 10,
    padding: 10,
  },
  infoBoxText: {
    color: '#E0F2FE',
    fontSize: 12,
    fontFamily: 'Courier',
  },
  errorBox: {
    backgroundColor: '#450A0A',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  errorCode: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  errorText: {
    color: '#FECACA',
    fontSize: 13,
    lineHeight: 19,
  },
  scannedBox: {
    backgroundColor: '#052E16',
    borderColor: '#16A34A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  scannedTitle: {
    color: '#4ADE80',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  monoLabel: {
    color: '#86EFAC',
    fontSize: 11,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  monoValue: {
    color: '#F0FDF4',
    fontSize: 13,
    fontFamily: 'Courier',
  },
  warningText: {
    color: '#FDE047',
    fontSize: 12,
    marginTop: 8,
  },
  scanButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#082F49',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelScanButton: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  cancelScanText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  label: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#F8FAFC',
    fontSize: 15,
  },
  habitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  inlineLink: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  inlineFormWrap: {
    marginTop: 6,
  },
  loader: {
    marginVertical: 16,
  },
  habitList: {
    gap: 8,
  },
  habitOption: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
  },
  habitOptionSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  habitOptionTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  habitOptionMeta: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 3,
  },
  claimButton: {
    backgroundColor: '#4ADE80',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  claimButtonText: {
    color: '#052E16',
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
