export type ToolId = 'runway' | 'midjourney' | 'elevenlabs' | 'pika' | 'udio';

export interface GenerationRecord {
  id: string;
  timestamp: string;
  tool: ToolId;
  model: string;
  prompt: string | null;
  credits_used: number | null;
  cost_usd: number | null;
  plan_rate: number | null;
  project_tag: string | null;
  duration_sec: number | null;
  resolution: string | null;
  generation_id: string | null;
  flagged: boolean;
}

export interface PlanConfig {
  tool: ToolId;
  plan_name: string;
  credits_per_dollar: number;
  detected_at: string;
}

export interface GenerationStartPayload {
  session_key: string;
  tool: ToolId;
  model?: string;
  prompt: string | null;
  balance_before: number;
}

export interface GenerationCompletePayload {
  session_key: string;
  tool: ToolId;
  /** null when the generation timed out and the actual cost is unknown. */
  balance_after: number | null;
  generation_id?: string;
  duration_sec?: number;
  resolution?: string;
}

export type ExtensionMessage =
  | { type: 'GENERATION_START'; payload: GenerationStartPayload }
  | { type: 'GENERATION_COMPLETE'; payload: GenerationCompletePayload };

export interface RecordFilters {
  tool?: ToolId;
  project_tag?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UsageStats {
  credits_today: number;
  credits_week: number;
  cost_month_usd: number;
  by_tool: Record<string, { credits: number; cost_usd: number }>;
}
