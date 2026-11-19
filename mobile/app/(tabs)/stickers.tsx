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
import type { CachedSticker } from '../../src/api/types';
import {
  getBootstrapCache,
  syncBootstrapCache,
} from '../../src/offline/stickerCache';

export default function StickersScreen() {
  const router = useRouter();
  const [stickers, setStickers] = useState<CachedSticker[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadStickers = useCallback(async (forceRefresh = false) => {
    const cached = await getBootstrapCache();
    if (cached) {
      setStickers(Object.values(cached.stickersByUuid));
    }
    if (forceRefresh) {
      setRefreshing(true);
    }
    try {
      const fresh = await syncBootstrapCache();
      setStickers(Object.values(fresh.stickersByUuid));
    } catch {
      // Offline — keep cached stickers
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStickers(false);
    }, [loadStickers]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.claimBanner}>
        <Text style={styles.claimTitle}>Claim a New Prove It Sticker</Text>
        <Text style={styles.claimBody}>
          Scan an unclaimed NTAG213/215 sticker in the foreground to bind its 7-byte hardware UID to your account and assign a habit.
        </Text>
        <Pressable
          style={styles.claimButton}
          onPress={() => router.push('/stickers/claim')}
        >
          <Text style={styles.claimButtonText}>Claim New Sticker</Text>
        </Pressable>
      </View>

      <FlatList
        data={stickers}
        keyExtractor={(item) => item.uuid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadStickers(true)}
            tintColor="#38BDF8"
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No claimed stickers synced yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.stickerCard}>
            <Pressable
              style={styles.stickerMain}
              onPress={() => router.push(`/stickers/${item.uuid}`)}
            >
              <Text style={styles.stickerLabel}>
                {item.label ?? 'Unnamed Sticker'}
              </Text>
              <Text style={styles.stickerHabit}>
                {item.habit ? item.habit.name : 'Unassigned — tap to assign habit'}
              </Text>
              <Text style={styles.stickerUuid}>{item.uuid}</Text>
            </Pressable>
            <View style={styles.cardActions}>
              <Pressable
                style={styles.secondaryAction}
                onPress={() => router.push(`/stickers/${item.uuid}`)}
              >
                <Text style={styles.secondaryActionText}>Settings</Text>
              </Pressable>
              <Pressable
                style={styles.verifyAction}
                onPress={() => router.push(`/t/${item.uuid}`)}
              >
                <Text style={styles.verifyActionText}>Check In</Text>
              </Pressable>
            </View>
          </View>
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
  claimBanner: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  claimTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  claimBody: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  claimButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  claimButtonText: {
    color: '#082F49',
    fontSize: 15,
    fontWeight: '700',
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  emptyText: {
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 24,
  },
  stickerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  stickerMain: {
    gap: 2,
  },
  stickerLabel: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  stickerHabit: {
    color: '#38BDF8',
    fontSize: 14,
    marginTop: 2,
  },
  stickerUuid: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'Courier',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryAction: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  verifyAction: {
    flex: 1,
    backgroundColor: '#0C4A6E',
    borderWidth: 1,
    borderColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  verifyActionText: {
    color: '#BAE6FD',
    fontSize: 13,
    fontWeight: '700',
  },
});
