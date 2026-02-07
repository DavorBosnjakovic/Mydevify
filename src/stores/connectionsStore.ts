// ============================================================
// Connections Store - Zustand state management
// ============================================================
// Manages connection state for all providers.
// Tokens stored in localStorage (upgrade to OS keychain in Phase 2).

import { create } from 'zustand';
import type { Connection, ConnectionProvider, ConnectionStatus, AccountInfo } from '../services/connections/types';
import { PROVIDERS } from '../services/connections/types';

// --------------- LocalStorage Keys ---------------

const STORAGE_KEY = 'mydevify_connections';

// --------------- Helpers ---------------

function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

function loadConnections(): Record<ConnectionProvider, Connection> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Restore connections, but reset 'connecting' status to 'disconnected'
      for (const key of Object.keys(parsed)) {
        if (parsed[key].status === 'connecting') {
          parsed[key].status = 'disconnected';
        }
      }
      return parsed;
    }
  } catch (e) {
    console.warn('Failed to load connections from storage:', e);
  }
  return {} as Record<ConnectionProvider, Connection>;
}

function saveConnections(connections: Record<string, Connection>) {
  try {
    // Don't persist tokens in plain localStorage in production
    // TODO: Phase 2 - use tauri-plugin-stronghold or OS keychain
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch (e) {
    console.warn('Failed to save connections to storage:', e);
  }
}

// --------------- Store Interface ---------------

interface ConnectionsState {
  connections: Partial<Record<ConnectionProvider, Connection>>;

  // Actions
  setConnecting: (provider: ConnectionProvider) => void;
  setConnected: (provider: ConnectionProvider, token: string, accountInfo: AccountInfo) => void;
  setError: (provider: ConnectionProvider, error: string) => void;
  disconnect: (provider: ConnectionProvider) => void;
  updateAccountInfo: (provider: ConnectionProvider, info: AccountInfo) => void;

  // Queries
  getConnection: (provider: ConnectionProvider) => Connection | undefined;
  getStatus: (provider: ConnectionProvider) => ConnectionStatus;
  isConnected: (provider: ConnectionProvider) => boolean;
  getConnectedProviders: () => ConnectionProvider[];
  getToken: (provider: ConnectionProvider) => string | undefined;
}

// --------------- Store ---------------

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: loadConnections(),

  setConnecting: (provider) => {
    set((state) => {
      const updated = {
        ...state.connections,
        [provider]: {
          ...state.connections[provider],
          provider,
          status: 'connecting' as ConnectionStatus,
          error: undefined,
        },
      };
      saveConnections(updated);
      return { connections: updated };
    });
  },

  setConnected: (provider, token, accountInfo) => {
    set((state) => {
      const now = Date.now();
      const updated = {
        ...state.connections,
        [provider]: {
          provider,
          status: 'connected' as ConnectionStatus,
          token,
          tokenLabel: maskToken(token),
          accountInfo,
          connectedAt: state.connections[provider]?.connectedAt || now,
          lastTestedAt: now,
          error: undefined,
        },
      };
      saveConnections(updated);
      return { connections: updated };
    });
  },

  setError: (provider, error) => {
    set((state) => {
      const updated = {
        ...state.connections,
        [provider]: {
          ...state.connections[provider],
          provider,
          status: 'error' as ConnectionStatus,
          error,
        },
      };
      saveConnections(updated);
      return { connections: updated };
    });
  },

  disconnect: (provider) => {
    set((state) => {
      const updated = { ...state.connections };
      delete updated[provider];
      saveConnections(updated);
      return { connections: updated };
    });
  },

  updateAccountInfo: (provider, info) => {
    set((state) => {
      const existing = state.connections[provider];
      if (!existing) return state;
      const updated = {
        ...state.connections,
        [provider]: {
          ...existing,
          accountInfo: { ...existing.accountInfo, ...info },
        },
      };
      saveConnections(updated);
      return { connections: updated };
    });
  },

  // Queries
  getConnection: (provider) => get().connections[provider],

  getStatus: (provider) => get().connections[provider]?.status || 'disconnected',

  isConnected: (provider) => get().connections[provider]?.status === 'connected',

  getConnectedProviders: () => {
    const conns = get().connections;
    return Object.keys(conns).filter(
      (k) => conns[k as ConnectionProvider]?.status === 'connected'
    ) as ConnectionProvider[];
  },

  getToken: (provider) => {
    const conn = get().connections[provider];
    return conn?.status === 'connected' ? conn.token : undefined;
  },
}));