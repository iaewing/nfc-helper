import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useAuth } from '../../src/auth/AuthContext';

export default function TabsLayout() {
  const { status } = useAuth();

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0F172A' },
        headerTintColor: '#F8FAFC',
        tabBarStyle: {
          backgroundColor: '#0F172A',
          borderTopColor: '#1E293B',
        },
        tabBarActiveTintColor: '#38BDF8',
        tabBarInactiveTintColor: '#64748B',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Habits',
          tabBarLabel: 'Habits',
        }}
      />
      <Tabs.Screen
        name="stickers"
        options={{
          title: 'Stickers',
          tabBarLabel: 'Stickers',
        }}
      />
    </Tabs>
  );
}
