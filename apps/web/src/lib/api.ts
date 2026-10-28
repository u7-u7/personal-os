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
  cron?: string;
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
  model?: string;
  fast_model?: string;
  reasoning_model?: string;
  decision_provider?: "rules" | "llm" | "jev";
  base_url?: string;
  api_key_configured?: boolean;
  memory_enabled?: boolean;
  timezone?: string;
  [key: string]: unknown;
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
        typeof body.detail === "string"
          ? body.detail
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
export function dateLabel(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(
        undefined,
        options || { month: "short", day: "numeric" },
      );
}
export function timeLabel(value?: string) {
  return value
    ? new Date(value).toLocaleTimeString([], {
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
