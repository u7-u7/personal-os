export interface RecordItem {
  id: string;
  version: number;
  created_at: string;
  updated_at?: string;
  extra?: Record<string, unknown>;
  title?: string;
  content?: string;
  category?: string;
  status?: string;
  priority?: string;
  due_at?: string | null;
  start_at?: string;
  end_at?: string;
  source?: string;
  source_id?: string;
  source_type?: string;
  prompt?: string;
  cron?: string | null;
  timezone?: string;
  next_run_at?: string;
  kind?: string;
  provider?: string;
  url?: string;
  trusted?: boolean;
  enabled?: boolean;
  permissions?: string[];
  action?: string;
  action_type?: string;
  tool?: string;
  can_resume?: boolean;
  cleanup?: {
    state: string;
    canonical_erased: boolean;
    store: string;
    checkpoints: string;
    provider: string;
    last_error_type?: string;
  };
  result?: unknown;
  error?: string;
  arguments?: Record<string, unknown>;
  summary?: string;
  role?: string;
  model?: string;
  payload?: Record<string, unknown>;
}
export interface User {
  id: string;
  email: string;
  name?: string;
}
export interface Settings {
  version: number;
  model?: string;
  fast_model?: string;
  reasoning_model?: string;
  decision_provider?: "rules" | "llm" | "jev";
  base_url?: string;
  api_key_configured?: boolean;
  chat_configured: boolean;
  chat_config_source: "personal" | "server_default" | "missing";
  ai_setup_complete: boolean;
  missing_configuration_fields: { chat: string[]; embedding: string[] };
  embedding_model?: string;
  embedding_base_url?: string;
  embedding_dimensions?: number;
  embedding_api_key_configured?: boolean;
  embedding_configured: boolean;
  embedding_index_status?: string;
  memory_enabled?: boolean;
  timezone?: string;
  google_calendar_connection?: { id: string; version: number } | null;
  [key: string]: unknown;
}
export interface ChatConnectionCheck {
  status: "ok";
  model: string;
  settings_version: number;
}
export interface ChatModelList {
  provider: "deepseek" | "openai_compatible";
  models: { id: string; owned_by: string; name?: string }[];
  settings_version: number;
}
export interface ChatBalance {
  provider: "deepseek" | "openai_compatible";
  supported: boolean;
  is_available?: boolean;
  balance_infos?: {
    currency: "CNY" | "USD";
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }[];
  settings_version: number;
}
export interface EmbeddingConnectionCheck {
  status: "ok";
  model: string;
  dimensions: number;
  provider: "dashscope";
  settings_version: number;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message =
        Array.isArray(body.detail) &&
        body.detail.every(
          (issue: unknown) =>
            typeof issue === "object" &&
            issue !== null &&
            "msg" in issue &&
            typeof issue.msg === "string",
        )
          ? body.detail.map((issue: { msg: string }) => issue.msg).join("\n")
          : typeof body.detail === "string"
            ? body.detail
            : typeof body.detail?.message === "string"
              ? body.detail.message
              : JSON.stringify(body.detail || body.error || body);
    } catch {
      /* Non-JSON upstream failures still preserve the status. */
    }
    throw new ApiError(message, response.status);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
export async function apiAllPages<T extends { id: string }>(
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const queryStart = path.indexOf("?");
  const pathname = queryStart < 0 ? path : path.slice(0, queryStart);
  const params = new URLSearchParams(
    queryStart < 0 ? "" : path.slice(queryStart + 1),
  );
  const records = new Map<string, T>();
  const pageSize = 200;
  let offset = 0;
  while (true) {
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    const page = await api<T[]>(`${pathname}?${params}`, { signal });
    const previousSize = records.size;
    for (const item of page) records.set(item.id, item);
    // Publish only a complete result; a later page failure must not look empty.
    if (page.length < pageSize) return Array.from(records.values());
    // Older servers may ignore offset. Fail explicitly instead of looping forever.
    if (records.size === previousSize)
      throw new Error("Pagination did not advance. Reload and retry.");
    offset += page.length;
  }
}
export function dateLabel(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(
        locale,
        options || { month: "short", day: "numeric" },
      );
}
export function timeLabel(value?: string, locale?: string) {
  return value
    ? new Date(value).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
export function inputDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
