import { create } from "zustand";

// ─── Types ───────────────────────────────────────────────────────────

export interface UsageEntry {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  inputCost: number;
  outputCost: number;
  taskLabel?: string; // Generic label like "Task 1" (privacy-first)
}

interface SessionData {
  id: string;
  startTime: number;
  entries: UsageEntry[];
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputCost: number;
  totalOutputCost: number;
}

interface StoredUsageData {
  sessions: {
    id: string;
    startTime: number;
    totalTokens: number;
    totalCost: number;
    entryCount: number;
  }[];
  entries: UsageEntry[]; // All entries (for monthly/all-time calc)
}

interface UsageState {
  // Current session
  session: SessionData;

  // Computed aggregates
  monthlyTokens: number;
  monthlyCost: number;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  monthlyInputCost: number;
  monthlyOutputCost: number;
  allTimeTokens: number;
  allTimeCost: number;
  allTimeInputTokens: number;
  allTimeOutputTokens: number;
  allTimeInputCost: number;
  allTimeOutputCost: number;

  // Budget
  monthlyBudget: number | null;
  budgetAlertEnabled: boolean;
  budgetAlertThreshold: number; // percentage (0-100), default 80

  // Actions
  trackAPICall: (params: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    taskLabel?: string;
  }) => UsageEntry;
  setMonthlyBudget: (budget: number | null) => void;
  setBudgetAlertEnabled: (enabled: boolean) => void;
  setBudgetAlertThreshold: (threshold: number) => void;
  resetSession: () => void;
  clearAllData: () => void;
  loadFromStorage: () => void;
}

// ─── Pricing (per 1M tokens) ────────────────────────────────────────

interface ModelPricing {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  "claude-opus": { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.50 },
  "claude-sonnet": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  "claude-haiku": { input: 0.25, output: 1.25, cacheCreation: 0.30, cacheRead: 0.03 },
  // OpenAI
  "gpt-4o": { input: 2.50, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5": { input: 0.50, output: 1.50 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.10, output: 4.40 },
  // Google Gemini
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-pro": { input: 1.25, output: 10 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  // Groq (free tier, but track tokens)
  "llama-3.3-70b": { input: 0.59, output: 0.79 },
  "llama-3.1-8b": { input: 0.05, output: 0.08 },
  "mixtral-8x7b": { input: 0.24, output: 0.24 },
  // Ollama (local = free)
  "ollama": { input: 0, output: 0 },
};

/**
 * Resolve pricing for a model string.
 * Matches by checking if the model name contains a known key.
 */
function getPricing(model: string, provider: string): ModelPricing {
  const m = model.toLowerCase();

  // Local models are free
  if (provider === "ollama") return { input: 0, output: 0 };

  // Try exact-ish matches
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (m.includes(key)) return pricing;
  }

  // Fallback: assume mid-range pricing so we don't undercount
  return { input: 3, output: 15 };
}

interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  total: number;
}

function calculateCost(
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number
): CostBreakdown {
  const pricing = getPricing(model, provider);

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheCreateCost = pricing.cacheCreation
    ? (cacheCreationTokens / 1_000_000) * pricing.cacheCreation
    : 0;
  const cacheReadCost = pricing.cacheRead
    ? (cacheReadTokens / 1_000_000) * pricing.cacheRead
    : 0;

  // Cache costs are part of input cost (they're input token variants)
  const totalInputCost = inputCost + cacheCreateCost + cacheReadCost;
  const totalOutputCost = outputCost;

  return {
    inputCost: totalInputCost,
    outputCost: totalOutputCost,
    total: totalInputCost + totalOutputCost,
  };
}

// ─── Storage helpers ────────────────────────────────────────────────

const STORAGE_KEY = "mydevify_usage";
const BUDGET_KEY = "mydevify_usage_budget";

function loadStoredData(): StoredUsageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [], entries: [] };
    return JSON.parse(raw);
  } catch {
    return { sessions: [], entries: [] };
  }
}

function saveStoredData(data: StoredUsageData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full – prune oldest entries (keep last 90 days)
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    data.entries = data.entries.filter((e) => e.timestamp > cutoff);
    data.sessions = data.sessions.filter((s) => s.startTime > cutoff);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Last resort: clear
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

function loadBudgetSettings(): {
  monthlyBudget: number | null;
  budgetAlertEnabled: boolean;
  budgetAlertThreshold: number;
} {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (!raw) return { monthlyBudget: null, budgetAlertEnabled: true, budgetAlertThreshold: 80 };
    return JSON.parse(raw);
  } catch {
    return { monthlyBudget: null, budgetAlertEnabled: true, budgetAlertThreshold: 80 };
  }
}

function saveBudgetSettings(budget: number | null, enabled: boolean, threshold: number) {
  localStorage.setItem(
    BUDGET_KEY,
    JSON.stringify({ monthlyBudget: budget, budgetAlertEnabled: enabled, budgetAlertThreshold: threshold })
  );
}

// ─── Aggregate helpers ──────────────────────────────────────────────

interface AggregateResult {
  tokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
}

function getMonthlyAggregates(entries: UsageEntry[]): AggregateResult {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  let tokens = 0;
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let inputCost = 0;
  let outputCost = 0;

  for (const e of entries) {
    const d = new Date(e.timestamp);
    if (d.getMonth() === month && d.getFullYear() === year) {
      tokens += e.totalTokens;
      cost += e.cost;
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
      inputCost += e.inputCost || 0;
      outputCost += e.outputCost || 0;
    }
  }

  return { tokens, cost, inputTokens, outputTokens, inputCost, outputCost };
}

function getAllTimeAggregates(entries: UsageEntry[]): AggregateResult {
  let tokens = 0;
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let inputCost = 0;
  let outputCost = 0;

  for (const e of entries) {
    tokens += e.totalTokens;
    cost += e.cost;
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    inputCost += e.inputCost || 0;
    outputCost += e.outputCost || 0;
  }

  return { tokens, cost, inputTokens, outputTokens, inputCost, outputCost };
}

// ─── Create new session ─────────────────────────────────────────────

function createSession(): SessionData {
  return {
    id: `session_${Date.now()}`,
    startTime: Date.now(),
    entries: [],
    totalTokens: 0,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalInputCost: 0,
    totalOutputCost: 0,
  };
}

// ─── Store ──────────────────────────────────────────────────────────

export const useUsageStore = create<UsageState>((set, get) => {
  // Load persisted data on init
  const stored = loadStoredData();
  const budgetSettings = loadBudgetSettings();
  const monthly = getMonthlyAggregates(stored.entries);
  const allTime = getAllTimeAggregates(stored.entries);

  return {
    session: createSession(),
    monthlyTokens: monthly.tokens,
    monthlyCost: monthly.cost,
    monthlyInputTokens: monthly.inputTokens,
    monthlyOutputTokens: monthly.outputTokens,
    monthlyInputCost: monthly.inputCost,
    monthlyOutputCost: monthly.outputCost,
    allTimeTokens: allTime.tokens,
    allTimeCost: allTime.cost,
    allTimeInputTokens: allTime.inputTokens,
    allTimeOutputTokens: allTime.outputTokens,
    allTimeInputCost: allTime.inputCost,
    allTimeOutputCost: allTime.outputCost,
    ...budgetSettings,

    trackAPICall: ({ model, provider, inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0, taskLabel }) => {
      const costBreakdown = calculateCost(model, provider, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

      const entry: UsageEntry = {
        id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        model,
        provider,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens,
        cost: costBreakdown.total,
        inputCost: costBreakdown.inputCost,
        outputCost: costBreakdown.outputCost,
        taskLabel,
      };

      set((state) => {
        const newSession: SessionData = {
          ...state.session,
          entries: [...state.session.entries, entry],
          totalTokens: state.session.totalTokens + entry.totalTokens,
          totalCost: state.session.totalCost + entry.cost,
          totalInputTokens: state.session.totalInputTokens + entry.inputTokens,
          totalOutputTokens: state.session.totalOutputTokens + entry.outputTokens,
          totalInputCost: state.session.totalInputCost + entry.inputCost,
          totalOutputCost: state.session.totalOutputCost + entry.outputCost,
        };

        const newMonthlyTokens = state.monthlyTokens + entry.totalTokens;
        const newMonthlyCost = state.monthlyCost + entry.cost;
        const newMonthlyInputTokens = state.monthlyInputTokens + entry.inputTokens;
        const newMonthlyOutputTokens = state.monthlyOutputTokens + entry.outputTokens;
        const newMonthlyInputCost = state.monthlyInputCost + entry.inputCost;
        const newMonthlyOutputCost = state.monthlyOutputCost + entry.outputCost;
        const newAllTimeTokens = state.allTimeTokens + entry.totalTokens;
        const newAllTimeCost = state.allTimeCost + entry.cost;
        const newAllTimeInputTokens = state.allTimeInputTokens + entry.inputTokens;
        const newAllTimeOutputTokens = state.allTimeOutputTokens + entry.outputTokens;
        const newAllTimeInputCost = state.allTimeInputCost + entry.inputCost;
        const newAllTimeOutputCost = state.allTimeOutputCost + entry.outputCost;

        // Persist to localStorage
        const stored = loadStoredData();
        stored.entries.push(entry);
        saveStoredData(stored);

        // Check budget alert
        if (
          state.budgetAlertEnabled &&
          state.monthlyBudget !== null &&
          newMonthlyCost >= state.monthlyBudget * (state.budgetAlertThreshold / 100) &&
          state.monthlyCost < state.monthlyBudget * (state.budgetAlertThreshold / 100)
        ) {
          console.warn(
            `[Mydevify] Budget alert: Monthly cost $${newMonthlyCost.toFixed(2)} ` +
            `reached ${state.budgetAlertThreshold}% of $${state.monthlyBudget} budget`
          );
        }

        return {
          session: newSession,
          monthlyTokens: newMonthlyTokens,
          monthlyCost: newMonthlyCost,
          monthlyInputTokens: newMonthlyInputTokens,
          monthlyOutputTokens: newMonthlyOutputTokens,
          monthlyInputCost: newMonthlyInputCost,
          monthlyOutputCost: newMonthlyOutputCost,
          allTimeTokens: newAllTimeTokens,
          allTimeCost: newAllTimeCost,
          allTimeInputTokens: newAllTimeInputTokens,
          allTimeOutputTokens: newAllTimeOutputTokens,
          allTimeInputCost: newAllTimeInputCost,
          allTimeOutputCost: newAllTimeOutputCost,
        };
      });

      return entry;
    },

    setMonthlyBudget: (budget) => {
      set({ monthlyBudget: budget });
      const s = get();
      saveBudgetSettings(budget, s.budgetAlertEnabled, s.budgetAlertThreshold);
    },

    setBudgetAlertEnabled: (enabled) => {
      set({ budgetAlertEnabled: enabled });
      const s = get();
      saveBudgetSettings(s.monthlyBudget, enabled, s.budgetAlertThreshold);
    },

    setBudgetAlertThreshold: (threshold) => {
      set({ budgetAlertThreshold: threshold });
      const s = get();
      saveBudgetSettings(s.monthlyBudget, s.budgetAlertEnabled, threshold);
    },

    resetSession: () => {
      const state = get();
      // Save current session summary to storage before resetting
      if (state.session.entries.length > 0) {
        const stored = loadStoredData();
        stored.sessions.push({
          id: state.session.id,
          startTime: state.session.startTime,
          totalTokens: state.session.totalTokens,
          totalCost: state.session.totalCost,
          entryCount: state.session.entries.length,
        });
        saveStoredData(stored);
      }
      set({ session: createSession() });
    },

    clearAllData: () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BUDGET_KEY);
      set({
        session: createSession(),
        monthlyTokens: 0,
        monthlyCost: 0,
        monthlyInputTokens: 0,
        monthlyOutputTokens: 0,
        monthlyInputCost: 0,
        monthlyOutputCost: 0,
        allTimeTokens: 0,
        allTimeCost: 0,
        allTimeInputTokens: 0,
        allTimeOutputTokens: 0,
        allTimeInputCost: 0,
        allTimeOutputCost: 0,
        monthlyBudget: null,
        budgetAlertEnabled: true,
        budgetAlertThreshold: 80,
      });
    },

    loadFromStorage: () => {
      const stored = loadStoredData();
      const budgetSettings = loadBudgetSettings();
      const monthly = getMonthlyAggregates(stored.entries);
      const allTime = getAllTimeAggregates(stored.entries);
      set({
        monthlyTokens: monthly.tokens,
        monthlyCost: monthly.cost,
        monthlyInputTokens: monthly.inputTokens,
        monthlyOutputTokens: monthly.outputTokens,
        monthlyInputCost: monthly.inputCost,
        monthlyOutputCost: monthly.outputCost,
        allTimeTokens: allTime.tokens,
        allTimeCost: allTime.cost,
        allTimeInputTokens: allTime.inputTokens,
        allTimeOutputTokens: allTime.outputTokens,
        allTimeInputCost: allTime.inputCost,
        allTimeOutputCost: allTime.outputCost,
        ...budgetSettings,
      });
    },
  };
});