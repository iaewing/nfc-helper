import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiRequest } from '../../src/api/client';
import type { HabitSummary, HabitsListResponse } from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import { formatVerificationLabel } from '../../src/components/HabitForm';
import {
  flushCheckInQueue,
  usePendingCheckInCount,
} from '../../src/offline/checkInQueue';
import {
  getBootstrapCache,
  syncBootstrapCache,
} from '../../src/offline/stickerCache';

export default function HabitsDashboardScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const pendingCount = usePendingCheckInCount();

  const [habits, setHabits] = useState<HabitSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (forceSync: boolean) => {
    const cached = await getBootstrapCache();
    if (cached) {
      setHabits(cached.habits);
    }

    if (forceSync) {
      setRefreshing(true);
    }
    try {
      const [habitsRes] = await Promise.all([
        apiRequest<HabitsListResponse>('/habits'),
        syncBootstrapCache().catch(() => null),
      ]);
      setHabits(habitsRes.habits);
    } catch {
      // Keep cached habits visible when offline
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData]),
  );

  const handleManualSync = async () => {
    setRefreshing(true);
    await flushCheckInQueue().catch(() => {});
    await loadData(true);
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.name ?? 'there'}</Text>
          <Text style={styles.timezone}>{user?.timezone ?? 'UTC'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.newHabitButton}
            onPress={() => router.push('/habits/new')}
          >
            <Text style={styles.newHabitText}>+ New</Text>
          </Pressable>
          <Pressable style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </Pressable>
        </View>
      </View>

      {pendingCount > 0 ? (
        <Pressable style={styles.syncBanner} onPress={handleManualSync}>
          <Text style={styles.syncBannerText}>
            {pendingCount} offline check-in{pendingCount === 1 ? '' : 's'} waiting to sync — Tap to retry
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={habits}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor="#38BDF8"
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No habits yet</Text>
            <Text style={styles.emptyBody}>
              Create your first habit or open the Stickers tab to claim a Prove It NFC sticker.
            </Text>
            <Pressable
              style={styles.emptyCta}
              onPress={() => router.push('/habits/new')}
            >
              <Text style={styles.emptyCtaText}>Create First Habit</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.habitCard, item.is_active === false && styles.pausedCard]}
            onPress={() => router.push(`/habits/${item.id}`)}
          >
            <View style={styles.habitInfo}>
              <Text style={styles.habitName}>
                {item.icon ? `${item.icon} ` : ''}
                {item.name}
              </Text>
              <Text style={styles.habitMeta}>
                {formatVerificationLabel(item.verification_type)}
                {item.require_hardware_uid ? ' · Chip Check' : ''} · Cooldown{' '}
                {item.cooldown_minutes}m
                {item.is_active === false ? ' · Paused' : ''}
              </Text>
            </View>
            <View style={styles.streakBadge}>
              <Text style={styles.streakValue}>{item.current_streak}</Text>
              <Text style={styles.streakLabel}>streak</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  greeting: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
  },
  timezone: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  newHabitButton: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  newHabitText: {
    color: '#082F49',
    fontSize: 13,
    fontWeight: '700',
  },
  logoutButton: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  syncBanner: {
    backgroundColor: '#422006',
    borderColor: '#CA8A04',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  syncBannerText: {
    color: '#FEF08A',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 16,
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyBody: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCta: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyCtaText: {
    color: '#082F49',
    fontSize: 14,
    fontWeight: '700',
  },
  habitCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pausedCard: {
    opacity: 0.65,
  },
  habitInfo: {
    flex: 1,
    paddingRight: 12,
  },
  habitName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  habitMeta: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
  },
  streakBadge: {
    backgroundColor: '#0C4A6E',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 64,
  },
  streakValue: {
    color: '#38BDF8',
    fontSize: 20,
    fontWeight: '800',
  },
  streakLabel: {
    color: '#BAE6FD',
    fontSize: 11,
    textTransform: 'uppercase',
  },
});
