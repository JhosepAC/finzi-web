import type { Currency } from "@/shared/money";
export type MovementFilters = { currency: Currency; kind: string; accountId: string; categoryId: string; period: string; from: string; to: string; query: string; status: string };
export type HistoryCursor = { at: string; id: string } | null;
export type MovementHistoryState = { filters: MovementFilters; draftFilters: MovementFilters; cursor: HistoryCursor; previous: HistoryCursor[]; traceId: string | null };
