/**
 * 🗄️ ZUSTAND STORE — Estado global persistente
 * 
 * CORRECCIÓN: Reemplaza el Context API con 50+ useState en layout.tsx.
 * Zustand persiste en localStorage (no se pierde al recargar).
 * Menor re-renders, código más limpio.
 * 
 * Uso:
 *   import { useAppStore } from '@/lib/store';
 *   const { user, setUser } = useAppStore();
 */

'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ===== TIPOS =====
export interface User {
  id: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  profilePic?: string | null;
  role: string;
  parentUserId?: string | null;
  permissions: Record<string, boolean>;
  apiKeyConnected: boolean;
  isSubUser: boolean;
  plan: 'trial' | 'starter' | 'business';
  trialEndsAt?: string | null;
  timezone?: string;
  storageUsed?: number;
  storageLimit?: number;
}

export interface WhatsappLine {
  id: string;
  label?: string | null;
  phone?: string | null;
  sessionName: string;
  status?: string;
  qr?: string | null;
}

// ===== STORE PRINCIPAL =====
interface AppStore {
  // Auth
  user: User | null;
  token: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  logout: () => void;
  isAuthenticated: () => boolean;

  // WhatsApp Lines
  lines: WhatsappLine[];
  selectedLine: WhatsappLine | null;
  setLines: (lines: WhatsappLine[]) => void;
  setSelectedLine: (line: WhatsappLine | null) => void;
  switchLine: (line: WhatsappLine) => void;

  // UI
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;

  // Impersonation (Admin)
  impersonating: boolean;
  impersonatingUser: string | null;
  setImpersonating: (value: boolean, userId?: string) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      token: null,
      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      logout: () => {
        set({ user: null, token: null, lines: [], selectedLine: null });
        // Limpiar localStorage adicional
        if (typeof window !== 'undefined') {
          localStorage.removeItem('bizonne_impersonating');
          localStorage.removeItem('bizonne_impersonating_user');
        }
      },
      isAuthenticated: () => !!get().token && !!get().user,

      // WhatsApp Lines
      lines: [],
      selectedLine: null,
      setLines: (lines) => set((state) => ({
        lines,
        // Auto-seleccionar la línea guardada o la primera
        selectedLine: state.selectedLine
          ? lines.find(l => l.id === state.selectedLine?.id) || lines[0] || null
          : lines[0] || null,
      })),
      setSelectedLine: (line) => set({ selectedLine: line }),
      switchLine: (line) => set({ selectedLine: line }),

      // UI
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      theme: 'dark',
      setTheme: (theme) => set({ theme }),

      // Impersonation
      impersonating: false,
      impersonatingUser: null,
      setImpersonating: (value, userId) => set({
        impersonating: value,
        impersonatingUser: userId || null,
      }),
    }),
    {
      name: 'bizonne-app-store',
      storage: createJSONStorage(() => localStorage),
      // Solo persistir estos campos
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        selectedLine: state.selectedLine,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
);

// ===== HOOKS ESPECIALIZADOS =====

/** Acceso rápido al user + token */
export const useAuth = () => {
  const { user, token, setUser, setToken, logout, isAuthenticated } = useAppStore();
  return { user, token, setUser, setToken, logout, isAuthenticated };
};

/** Acceso rápido a las líneas de WhatsApp */
export const useLines = () => {
  const { lines, selectedLine, setLines, setSelectedLine, switchLine } = useAppStore();
  return { lines, selectedLine, setLines, setSelectedLine, switchLine };
};
