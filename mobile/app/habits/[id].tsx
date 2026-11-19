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
  View,
} from 'react-native';
import { ApiError, apiRequest } from '../../src/api/client';
import type {
  Habit,
  HabitDetailResponse,
  HabitMutationResponse,
  HabitPayload,
  RecentCheckIn,
} from '../../src/api/types';
import { HabitForm } from '../../src/components/HabitForm';
import { syncBootstrapCache } from '../../src/offline/stickerCache';

export default function EditHabitScreen() {
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const [habit, setHabit] = useState<Habit | null>(null);
  const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchHabit = useCallback(async () => {
    if (!id) {
      setLoadError('Invalid habit ID.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiRequest<HabitDetailResponse>(
        `/habits/${encodeURIComponent(id)}`,
      );
      setHabit(response.habit);
      setRecentCheckIns(response.recent_check_ins);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : 'Unable to load habit details.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchHabit();
  }, [fetchHabit]);

  const handleUpdate = async (payload: HabitPayload) => {
    if (!id) return;
    await apiRequest<HabitMutationResponse>(`/habits/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
    });
    await syncBootstrapCache().catch(() => {});
    router.back();
  };

  const confirmDelete = () => {
    if (!id || !habit) return;
    Alert.alert(
      'Delete Habit',
      `Delete "${habit.name}"? Any linked stickers will be unassigned (not erased).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiRequest(`/habits/${encodeURIComponent(id)}`, {
                method: 'DELETE',
              });
              await syncBootstrapCache().catch(() => {});
              router.back();
            } catch (err) {
              Alert.alert(
                'Delete Failed',
                err instanceof ApiError ? err.message : 'Could not delete habit.',
              );
              setDeleting(false);
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

  if (loadError || !habit) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Unable to Load Habit</Text>
        <Text style={styles.errorBody}>{loadError ?? 'Habit not found.'}</Text>
        <Pressable style={styles.retryButton} onPress={fetchHabit}>
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
        <View style={styles.statsCard}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{habit.current_streak}</Text>
            <Text style={styles.statLabel}>Current Streak</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{habit.longest_streak}</Text>
            <Text style={styles.statLabel}>Longest</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{habit.stickers.length}</Text>
            <Text style={styles.statLabel}>Stickers</Text>
          </View>
        </View>

        {recentCheckIns.length > 0 ? (
          <View style={styles.historyCard}>
            <Text style={styles.historyTitle}>Recent Check-Ins</Text>
            {recentCheckIns.slice(0, 5).map((item) => (
              <View key={item.id} style={styles.historyRow}>
                <Text style={styles.historyDate}>
                  {new Date(item.tapped_at).toLocaleString()}
                </Text>
                <Text style={styles.historyMeta}>
                  {item.hardware_uid_verified ? 'Chip Verified' : item.source}
                  {item.has_photo ? ' · Photo' : ''}
                  {item.distance_meters !== null ? ` · ${item.distance_meters}m` : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <HabitForm
          initialHabit={habit}
          submitLabel="Save Changes"
          showActiveToggle
          onSubmit={handleUpdate}
        />

        <Pressable
          style={[styles.deleteButton, deleting && styles.buttonDisabled]}
          onPress={confirmDelete}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator color="#FCA5A5" />
          ) : (
            <Text style={styles.deleteButtonText}>Delete Habit</Text>
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
    fontSize: 15,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    justifyContent: 'space-around',
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    color: '#38BDF8',
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 11,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  historyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    gap: 8,
  },
  historyTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
    gap: 8,
  },
  historyDate: {
    color: '#E2E8F0',
    fontSize: 12,
  },
  historyMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  deleteButton: {
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#991B1B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: '#FCA5A5',
    fontSize: 15,
    fontWeight: '700',
  },
});
