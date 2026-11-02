import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PREVIEW_SCOPE_KEY_PREFIX } from '@/renderer/pages/conversation/Preview/context/previewScope';
import { isBackendHttpError, resolveCoreCsrfToken } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import type { AuthRole, IAuthUser } from '@/common/types/auth';

/** Authenticated user identity — shared with the admin console types. */
export type AuthUser = IAuthUser;
export type { AuthRole };

const CSRF_COOKIE_NAME = 'aionui-csrf-token';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface LoginParams {
  username: string;
  password: string;
  remember?: boolean;
}

type LoginErrorCode =
  | 'invalidCredentials'
  | 'tooManyAttempts'
  | 'serverError'
  | 'networkError'
  | 'csrfError'
  | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
  shouldClearCache?: boolean;
}

interface RegisterParams {
  code: string;
  username: string;
  password: string;
}

type RegisterErrorCode =
  | 'invalidCode'
  | 'expiredCode'
  | 'usernameTaken'
  | 'weakPassword'
  | 'rateLimited'
  | 'serverError'
  | 'networkError'
  | 'unknown';

interface RegisterResult {
  success: boolean;
  message?: string;
  code?: RegisterErrorCode;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  login: (params: LoginParams) => Promise<LoginResult>;
  register: (params: RegisterParams) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthUser | null>;
  clearAuthCache: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

// Clear expired auth cache including cookies and localStorage
// 清除过期的认证缓存，包括 Cookie 和 localStorage
function clearAuthCache(): void {
  if (typeof window === 'undefined') return;

  try {
    // Clear CSRF cookie (readable double-submit cookie — safe to drop client-side;
    // the backend mints a fresh one on the next login)
    clearCookie(CSRF_COOKIE_NAME);
    clearCookie(CSRF_COOKIE_NAME, '/');

    // Clear localStorage auth-related items, plus per-user UI state that must not
    // leak across accounts. Preview scopes are keyed by project id and hold file
    // content, so leaving them behind would show the next user the previous one's
    // open tabs — and nothing else ever cleaned them up.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes('auth') ||
          key.includes('csrf') ||
          key.includes('token') ||
          key.startsWith(PREVIEW_SCOPE_KEY_PREFIX))
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear auth cache:', error);
  }
}

/** Expire a readable cookie client-side (backend re-mints on next login). */
function clearCookie(name: string, path?: string): void {
  if (typeof document === 'undefined') return;
  const suffix = path ? `; path=${path}` : '';
  document.cookie = `${name}=; Max-Age=0${suffix}`;
}

/** Shared CSRF echo-header for the raw fetches below (login/logout). */
function csrfHeaders(): Record<string, string> {
  const token = resolveCoreCsrfToken();
  return token ? { 'x-csrf-token': token } : {};
}

async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    let response = await fetch(AUTH_USER_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    // The access cookie may have expired — attempt one silent session refresh
    // and re-check before concluding the user is unauthenticated. Without this
    // the status poll would kick a refreshable session to /login (#4124).
    // refreshSession() single-flights with the httpBridge refresh path.
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        response = await fetch(AUTH_USER_ENDPOINT, {
          method: 'GET',
          credentials: 'include',
          signal,
        });
      }
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      success: boolean;
      user?: AuthUser;
    };
    if (data.success && data.user) {
      return data.user;
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null;
    }
    console.error('Failed to fetch current user:', error);
  }

  return null;
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Re-check the session against /api/auth/user. Returns the authenticated user
   * (null otherwise) so callers like `register` can bootstrap off its result.
   */
  const refresh = useCallback(async (): Promise<AuthUser | null> => {
    if (isDesktopRuntime) {
      setStatus('authenticated');
      setUser(null);
      setReady(true);
      return null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('checking');

    const currentUser = await fetchCurrentUser(controller.signal);
    if (currentUser) {
      setUser(currentUser);
      setStatus('authenticated');
    } else {
      setUser(null);
      setStatus('unauthenticated');
    }
    setReady(true);
    return currentUser;
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  const login = useCallback(async ({ username, password, remember }: LoginParams): Promise<LoginResult> => {
    try {
      if (isDesktopRuntime) {
        setReady(true);
        return { success: true };
      }

      // Backend route is /login; web-host's static-server explicitly proxies it.
      // CSRF double-submit: echo the backend's csrf cookie in the header.
      const response = await fetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ username, password, remember }),
      });

      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        user?: AuthUser;
      };

      if (!response.ok || !data.success || !data.user) {
        let code: LoginErrorCode = 'unknown';
        let message = data?.message ?? 'Login failed';
        let shouldClearCache = false;

        if (response.status === 401) {
          code = 'invalidCredentials';
        } else if (response.status === 403) {
          // CSRF validation failed - clear cache
          code = 'csrfError';
          message = 'Security token expired. Please try again.';
          shouldClearCache = true;
        } else if (response.status === 429) {
          code = 'tooManyAttempts';
        } else if (response.status >= 500) {
          code = 'serverError';
        }

        // Clear cache on CSRF-related errors
        if (shouldClearCache) {
          clearAuthCache();
        }

        return {
          success: false,
          message,
          code,
          shouldClearCache,
        };
      }

      setUser(data.user);
      setStatus('authenticated');
      setReady(true);

      // Re-enable WebSocket reconnection after successful login (WebUI mode only)
      if (typeof window !== 'undefined' && (window as any).__websocketReconnect) {
        (window as any).__websocketReconnect();
      }

      return { success: true };
    } catch (error) {
      console.error('Login request failed:', error);

      // Check if error is related to CSRF token parsing
      const errorMessage = (error as Error).message;
      if (errorMessage?.includes('parse') || errorMessage?.includes('csrf') || errorMessage?.includes('cookie')) {
        // CSRF or cookie parsing error - clear cache
        clearAuthCache();
        return {
          success: false,
          message: 'Login failed due to cached data. Please clear your browser cache and try again.',
          code: 'csrfError',
          shouldClearCache: true,
        };
      }

      return {
        success: false,
        message: 'Network error. Please try again.',
        code: 'networkError',
      };
    }
  }, []);

  /**
   * Invite redemption. POSTs /api/auth/register via the ipcBridge HTTP route;
   * on success the backend has already set the session cookies, so this runs
   * the same bootstrap the login success path uses (user + authenticated state,
   * WS reconnect). Failure maps the backend error to a coarse client code.
   */
  const register = useCallback(
    async ({ code, username, password }: RegisterParams): Promise<RegisterResult> => {
      if (isDesktopRuntime) {
        return { success: false, code: 'unknown', message: 'Registration requires the web app' };
      }
      try {
        const user = await ipcBridge.auth.register.invoke({ code: code.trim(), username: username.trim(), password });

        if (user?.id) {
          setUser(user);
          setStatus('authenticated');
          setReady(true);
        } else {
          // Unexpected response shape — fall back to the standard session
          // bootstrap; it either resolves the fresh session or reports
          // unauthenticated, which we surface as a failure.
          const bootstrapped = await refresh();
          if (!bootstrapped) {
            return { success: false, code: 'unknown' };
          }
        }

        // Re-enable WebSocket reconnection after successful registration
        if (typeof window !== 'undefined' && (window as { __websocketReconnect?: () => void }).__websocketReconnect) {
          (window as { __websocketReconnect?: () => void }).__websocketReconnect?.();
        }

        return { success: true };
      } catch (error) {
        if (isBackendHttpError(error)) {
          const backendCode = error.code.toLowerCase();
          let code: RegisterErrorCode = 'unknown';
          if (error.status === 429) {
            code = 'rateLimited';
          } else if (error.status >= 500) {
            code = 'serverError';
          } else if (backendCode.includes('expire') || error.status === 410) {
            code = 'expiredCode';
          } else if (
            backendCode.includes('password') &&
            (backendCode.includes('weak') || backendCode.includes('invalid') || backendCode.includes('policy'))
          ) {
            code = 'weakPassword';
          } else if (
            backendCode.includes('taken') ||
            backendCode.includes('exists') ||
            backendCode.includes('conflict') ||
            error.status === 409
          ) {
            code = 'usernameTaken';
          } else if (error.status === 400 || error.status === 401 || error.status === 403 || error.status === 404) {
            code = 'invalidCode';
          }
          return { success: false, code, message: error.backendMessage || undefined };
        }
        console.error('Register request failed:', error);
        return { success: false, code: 'networkError' };
      }
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    if (isDesktopRuntime) {
      setUser(null);
      setStatus('authenticated');
      setReady(true);
      return;
    }

    try {
      await fetch('/logout', {
        method: 'POST',
        // Logout also needs CSRF token / 登出同样需要 CSRF Token
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      // Clear cache on logout for security
      clearAuthCache();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      login,
      register,
      logout,
      refresh,
      clearAuthCache,
    }),
    [login, register, logout, ready, refresh, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
