import { env } from '../config/env';
import { getAuthToken } from '../auth/tokenStorage';

const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  public readonly status: number | null;
  public readonly code: string | null;
  public readonly meta: Record<string, unknown> | null;
  public readonly isNetworkError: boolean;

  constructor(options: {
    message: string;
    status?: number | null;
    code?: string | null;
    meta?: Record<string, unknown> | null;
    isNetworkError?: boolean;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.meta = options.meta ?? null;
    this.isNetworkError = options.isNetworkError ?? false;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  authenticated?: boolean;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    authenticated = true,
  } = options;

  const token = authenticated ? (options.token ?? (await getAuthToken())) : null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = null;
      }
    }

    if (response.status === 401 && authenticated) {
      unauthorizedHandler?.();
    }

    if (!response.ok) {
      const validationErrors = json?.errors as Record<string, string[]> | undefined;
      const firstValidationMessage = validationErrors
        ? Object.values(validationErrors)[0]?.[0]
        : undefined;

      throw new ApiError({
        status: response.status,
        code: typeof json?.code === 'string' ? json.code : (typeof json?.state === 'string' ? json.state : null),
        message:
          firstValidationMessage ??
          (typeof json?.message === 'string' ? json.message : `Request failed (${response.status})`),
        meta: (json?.meta as Record<string, unknown> | undefined) ?? json,
      });
    }

    return json as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    const isAbort = error instanceof Error && error.name === 'AbortError';
    throw new ApiError({
      message: isAbort
        ? 'Network request timed out.'
        : 'Unable to reach the server. Check your connection.',
      isNetworkError: true,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
