import { useRouter } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { apiRequest } from '../../src/api/client';
import type { HabitMutationResponse, HabitPayload } from '../../src/api/types';
import { HabitForm } from '../../src/components/HabitForm';
import { syncBootstrapCache } from '../../src/offline/stickerCache';

export default function NewHabitScreen() {
  const router = useRouter();

  const handleCreate = async (payload: HabitPayload) => {
    await apiRequest<HabitMutationResponse>('/habits', {
      method: 'POST',
      body: payload,
    });
    await syncBootstrapCache().catch(() => {});
    router.back();
  };

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
        <HabitForm submitLabel="Create Habit" onSubmit={handleCreate} />
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
    paddingBottom: 40,
  },
});
