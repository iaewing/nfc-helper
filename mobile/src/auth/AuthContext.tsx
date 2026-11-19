import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import { ApiError, apiRequest, setUnauthorizedHandler } from '../api/client';
import type { AuthResponse, User } from '../api/types';
import { clearCheckInQueue, flushCheckInQueue } from '../offline/checkInQueue';
import { clearBootstrapCache, syncBootstrapCache } from '../offline/stickerCache';
import {
  clearAuthToken,
  clearCachedUser,
  getAuthToken,
  getCachedUser,
  setAuthToken,
  setCachedUser,
} from './tokenStorage';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface LoginInput {
  email: string;
  password: string;
}

interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getDeviceName(): string {
  return `${Platform.OS === 'ios' ? 'iOS' : 'Android'} Device`;
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const resetSession = useCallback(async () => {
    await Promise.all([
      clearAuthToken(),
      clearCachedUser(),
      clearBootstrapCache(),
      clearCheckInQueue(),
    ]);
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      resetSession().catch(() => {});
    });
    return () => setUnauthorizedHandler(null);
  }, [resetSession]);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      try {
        const storedToken = await getAuthToken();
        if (!storedToken) {
          if (mounted) setStatus('unauthenticated');
          return;
        }

        const cachedUser = await getCachedUser();
        if (mounted) {
          setToken(storedToken);
          if (cachedUser) {
            setUser(cachedUser);
            setStatus('authenticated');
          }
        }

        try {
          const response = await apiRequest<{ user: User }>('/auth/me', {
            token: storedToken,
          });
          await setCachedUser(response.user);
          if (mounted) {
            setUser(response.user);
            setStatus('authenticated');
          }
          syncBootstrapCache().catch(() => {});
          flushCheckInQueue().catch(() => {});
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await resetSession();
            return;
          }

          if (cachedUser) {
            // Preserve authenticated state on network errors, 5xx, or 429 when cached user exists
            if (mounted) {
              setStatus('authenticated');
            }
            return;
          }

          if (mounted) {
            setStatus('unauthenticated');
          }
        }
      } catch {
        if (mounted) setStatus('unauthenticated');
      }
    }

    hydrate();

    return () => {
      mounted = false;
    };
  }, []);

  const persistAuth = useCallback(async (auth: AuthResponse) => {
    await setAuthToken(auth.token);
    await setCachedUser(auth.user);
    setToken(auth.token);
    setUser(auth.user);
    setStatus('authenticated');
    syncBootstrapCache().catch(() => {});
  }, []);

  const login = useCallback(
    async ({ email, password }: LoginInput) => {
      const response = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        authenticated: false,
        body: {
          email: email.trim(),
          password,
          device_name: getDeviceName(),
          timezone: getLocalTimezone(),
        },
      });
      await persistAuth(response);
    },
    [persistAuth],
  );

  const register = useCallback(
    async ({ name, email, password }: RegisterInput) => {
      const response = await apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        authenticated: false,
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
          device_name: getDeviceName(),
          timezone: getLocalTimezone(),
        },
      });
      await persistAuth(response);
    },
    [persistAuth],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session even if server is unreachable
    } finally {
      await resetSession();
    }
  }, [resetSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, token, login, register, logout }),
    [status, user, token, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
