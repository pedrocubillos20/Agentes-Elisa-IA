/**
 * 🌐 API CLIENT — Fetch con auth automático
 * 
 * CORRECCIÓN: Centraliza todas las llamadas a la API.
 * - Agrega token automáticamente
 * - Maneja 401 con refresh token automático
 * - Tipado correcto
 * 
 * Uso:
 *   import { apiClient } from '@/lib/api';
 *   const data = await apiClient.get('/api/assistants');
 *   const result = await apiClient.post('/api/auth/login', { email, password });
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

let isRefreshing = false;
let failedQueue: Array<{ resolve: Function; reject: Function }> = [];

const processQueue = (error: any, token: string | null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  failedQueue = [];
};

const getToken = (): string | null => {
  try {
    const stored = localStorage.getItem('bizonne-app-store');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.state?.token || null;
  } catch { return null; }
};

const setToken = (token: string) => {
  try {
    const stored = localStorage.getItem('bizonne-app-store');
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.state.token = token;
      localStorage.setItem('bizonne-app-store', JSON.stringify(parsed));
    }
  } catch {}
};

const clearSession = () => {
  localStorage.removeItem('bizonne-app-store');
  window.location.href = '/login';
};

async function refreshAccessToken(): Promise<string | null> {
  // Obtener refreshToken del store
  try {
    const stored = localStorage.getItem('bizonne-app-store');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const refreshToken = parsed?.state?.refreshToken;
    if (!refreshToken) return null;

    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken || null;
  } catch { return null; }
}

async function request<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Token expirado — intentar refresh
  if (response.status === 401) {
    const body = await response.json().catch(() => ({}));
    
    if (body.code === 'TOKEN_EXPIRED' && !isRefreshing) {
      isRefreshing = true;

      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });

        refreshAccessToken().then(newToken => {
          if (newToken) {
            setToken(newToken);
            isRefreshing = false;
            processQueue(null, newToken);
            // Reintentar request original
            resolve(request<T>(endpoint, options));
          } else {
            isRefreshing = false;
            processQueue(new Error('Session expired'), null);
            clearSession();
            reject(new Error('Session expired'));
          }
        });
      });
    }

    throw { status: 401, message: body.error || 'No autorizado', ...body };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw { status: response.status, ...error };
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return response.text() as unknown as Promise<T>;
}

export const apiClient = {
  get: <T = any>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = any>(endpoint: string, options?: RequestInit) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};

export const API_URL_BASE = API_URL;
