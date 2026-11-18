import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
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

  const loadStickers = useCallback(async () => {
    const cached = await getBootstrapCache();
    if (cached) {
      setStickers(Object.values(cached.stickersByUuid));
    }
    try {
      const fresh = await syncBootstrapCache();
      setStickers(Object.values(fresh.stickersByUuid));
    } catch {
      // Offline — keep cached stickers
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStickers();
    }, [loadStickers]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.phaseNotice}>
        <Text style={styles.phaseTitle}>Foreground NFC Claiming</Text>
        <Text style={styles.phaseBody}>
          Foreground NTAG213/215 claiming (NDEF + 7-byte hardware UID binding) is scheduled for Phase 3. You can test background Universal Link taps right now via /t/[uuid].
        </Text>
      </View>

      <FlatList
        data={stickers}
        keyExtractor={(item) => item.uuid}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No claimed stickers synced yet.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.stickerCard}
            onPress={() => router.push(`/t/${item.uuid}`)}
          >
            <Text style={styles.stickerLabel}>
              {item.label ?? 'Unnamed Sticker'}
            </Text>
            <Text style={styles.stickerHabit}>
              {item.habit ? item.habit.name : 'Unassigned'}
            </Text>
            <Text style={styles.stickerUuid}>{item.uuid}</Text>
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
  phaseNotice: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  phaseTitle: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  phaseBody: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 19,
  },
  listContent: {
    gap: 12,
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
  },
  stickerLabel: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  stickerHabit: {
    color: '#38BDF8',
    fontSize: 14,
    marginTop: 4,
  },
  stickerUuid: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 6,
    fontFamily: 'Courier',
  },
});
