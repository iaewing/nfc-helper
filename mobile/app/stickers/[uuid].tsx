import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  HabitsListResponse,
  StickerDetail,
  StickerResponse,
  UnclaimStickerResponse,
} from '../../src/api/types';
import { formatVerificationLabel } from '../../src/components/HabitForm';
import { syncBootstrapCache } from '../../src/offline/stickerCache';

export default function ManageStickerScreen() {
  const router = useRouter();
  const { uuid: rawUuid } = useLocalSearchParams<{ uuid?: string | string[] }>();
  const uuid = Array.isArray(rawUuid) ? rawUuid[0] : rawUuid;

  const [sticker, setSticker] = useState<StickerDetail | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [label, setLabel] = useState('');
  const [selectedHabitId, setSelectedHabitId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!uuid) {
      setError('Missing sticker UUID.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [stickerRes, habitsRes] = await Promise.all([
        apiRequest<StickerResponse>(`/stickers/${encodeURIComponent(uuid)}`),
        apiRequest<HabitsListResponse>('/habits'),
      ]);

      setSticker(stickerRes.sticker);
      setLabel(stickerRes.sticker.label ?? '');
      setSelectedHabitId(stickerRes.sticker.habit_id);
      setHabits(habitsRes.habits);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to load sticker settings.',
      );
    } finally {
      setLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!uuid) return;
    setError(null);
    setSaving(true);
    try {
      const res = await apiRequest<StickerResponse>(
        `/stickers/${encodeURIComponent(uuid)}`,
        {
          method: 'PATCH',
          body: {
            label: label.trim() ? label.trim() : null,
            habit_id: selectedHabitId,
          },
        },
      );
      setSticker(res.sticker);
      await syncBootstrapCache().catch(() => {});
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update sticker.');
    } finally {
      setSaving(false);
    }
  };

  const confirmRelease = (action: 'unclaim' | 'disable') => {
    if (!uuid) return;
    const isDisable = action === 'disable';
    Alert.alert(
      isDisable ? 'Disable Lost Sticker' : 'Unclaim Sticker',
      isDisable
        ? 'Permanently disable this sticker? Its chip UID will stay blocked from re-claiming.'
        : 'Unbind this sticker from your account? It can be claimed again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isDisable ? 'Disable' : 'Unclaim',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await apiRequest<UnclaimStickerResponse>(
                `/stickers/${encodeURIComponent(uuid)}/claim?action=${action}`,
                { method: 'DELETE' },
              );
              await syncBootstrapCache().catch(() => {});
              router.replace('/(tabs)/stickers');
            } catch (err) {
              Alert.alert(
                'Action Failed',
                err instanceof ApiError ? err.message : 'Unable to complete request.',
              );
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  if (!sticker) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Unable to Load Sticker</Text>
        <Text style={styles.errorBody}>{error ?? 'Sticker not found.'}</Text>
        <Pressable style={styles.retryButton} onPress={loadData}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

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
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sticker Identity</Text>
          <Text style={styles.monoLabel}>UUID</Text>
          <Text style={styles.monoValue}>{sticker.uuid}</Text>
          <Text style={styles.monoLabel}>Hardware UID</Text>
          <Text style={styles.monoValue}>
            {sticker.hardware_uid ?? 'Not recorded'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Label & Assigned Habit</Text>
          <Text style={styles.label}>Label</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Coffee Maker"
            placeholderTextColor="#64748B"
            value={label}
            onChangeText={setLabel}
            maxLength={100}
          />

          <Text style={styles.label}>Assigned Habit</Text>
          <View style={styles.habitList}>
            <Pressable
              style={[
                styles.habitOption,
                selectedHabitId === null && styles.habitOptionSelected,
              ]}
              onPress={() => setSelectedHabitId(null)}
            >
              <Text style={styles.habitOptionTitle}>Unassigned</Text>
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
                    {!habit.is_active ? ' · Paused' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#082F49" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </Pressable>

        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Sticker Lifecycle</Text>
          <Pressable
            style={styles.secondaryDangerButton}
            onPress={() => confirmRelease('unclaim')}
            disabled={saving}
          >
            <Text style={styles.secondaryDangerText}>Unclaim Sticker</Text>
          </Pressable>
          <Pressable
            style={styles.dangerButton}
            onPress={() => confirmRelease('disable')}
            disabled={saving}
          >
            <Text style={styles.dangerButtonText}>Disable Lost Sticker</Text>
          </Pressable>
        </View>
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
  centered: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorBody: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: '#082F49',
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#450A0A',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#FECACA',
    fontSize: 13,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  monoLabel: {
    color: '#94A3B8',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  monoValue: {
    color: '#E2E8F0',
    fontSize: 13,
    fontFamily: 'Courier',
    marginBottom: 4,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
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
  habitList: {
    gap: 8,
    marginTop: 4,
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
  saveButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#082F49',
    fontSize: 16,
    fontWeight: '700',
  },
  dangerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  dangerTitle: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryDangerButton: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#64748B',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryDangerText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#991B1B',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
