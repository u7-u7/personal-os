"use client";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Brain,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Compass,
  Edit3,
  FileText,
  History,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquare,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  apiAllPages,
  ApiError,
  inputDate,
  type CalendarColor,
  type CalendarEvent,
  type CalendarItem,
  type EventScope,
  type NotificationItem,
  type RecordItem,
  type Settings,
  type User,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useI18n, LanguageSelector } from "@/components/i18n-provider";
import { EmbeddingSettings } from "@/components/embedding-settings";
import { ChatSettings } from "@/components/chat-settings";
import { MessageMarkdown } from "@/components/message-markdown";
import {
  AISetupNotice,
  useAIConfiguration,
} from "@/components/ai-configuration";

const resourcePaths: Record<string, string> = {
  tasks: "/tasks",
  memory: "/memories",
  calendar: "/events",
  automations: "/automations",
  integrations: "/integrations",
};
function useRecords(kind: string) {
  return useQuery({
    queryKey: [kind],
    queryFn: ({ signal }) => {
      const path = resourcePaths[kind] || `/${kind}`;
      return ["tasks", "automations", "approvals"].includes(kind)
        ? apiAllPages<RecordItem>(path, signal)
        : api<RecordItem[]>(path, { signal });
    },
  });
}
function useAction() {
  const query = useQueryClient();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(undefined);
    try {
      await action();
      await query.invalidateQueries();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, error, pending, clear: () => setError(undefined) };
}
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Empty({
  icon = <Leaf size={27} strokeWidth={1.3} />,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Failure({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  const { t, errorText } = useI18n();
  return error ? (
    <div className="error-banner" role="alert">
      <span>{errorText(error.message)}</span>
      {retry && (
        <button onClick={retry}>
          {t("Try again")} <RefreshCw size={13} />
        </button>
      )}
    </div>
  ) : null;
}
function Loading() {
  const { t } = useI18n();
  return (
    <div className="skeleton-list" aria-label={t("Loading")}>
      <div />
      <div />
      <div />
    </div>
  );
}
function Badge({ status }: { status?: string }) {
  const { t } = useI18n();
  return (
    <span className={`badge badge-${status || "default"}`}>
      {t(
        status === "superseded"
          ? "replaced"
          : status?.replaceAll("_", " ") || "unknown",
      )}
    </span>
  );
}
function ErrorText({ text }: { text?: string }) {
  const { t, errorText } = useI18n();
  return text ? (
    <div className="error-banner" role="alert">
      {errorText(t(text))}
    </div>
  ) : null;
}
function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="row-actions">
      <button className="icon-button" aria-label={t("Edit")} onClick={onEdit}>
        <Edit3 size={15} />
      </button>
      <button
        className="icon-button delete"
        aria-label={t("Delete")}
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
async function remove(
  kind: string,
  item: RecordItem,
  t: (message: string) => string,
) {
  const result = await api<{ approval_required?: boolean }>(
    `${resourcePaths[kind]}/${item.id}?version=${item.version}`,
    { method: "DELETE", body: JSON.stringify({ version: item.version }) },
  );
  if (result?.approval_required)
    alert(
      t(
        "Deletion is waiting for your approval. Review the request in Activity & approvals.",
      ),
    );
  return result;
}

async function downloadExport() {
  const data = await api<unknown>("/export");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `personalos-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Dashboard {
  stats: {
    tasks: number;
    memories: number;
    automations: number;
    approvals: number;
  };
  tasks: RecordItem[];
  events: CalendarEvent[];
  memories: RecordItem[];
  automations: RecordItem[];
  approvals: RecordItem[];
  briefing: RecordItem | null;
}
export function DashboardPage({ user }: { user: User }) {
  const { t, locale, dateLabel, timeLabel } = useI18n();
  const configuration = useAIConfiguration();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/dashboard"),
  });
  const action = useAction();
  const data = query.data;
  const [editor, setEditor] = useState(false);
  const [briefing, setBriefing] = useState<RecordItem>();
  const briefingHistory = useQuery({
    queryKey: ["briefings"],
    queryFn: () => api<RecordItem[]>("/briefings"),
  });
  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? t("Good morning")
      : now.getHours() < 18
        ? t("Good afternoon")
        : t("Good evening");
  async function generate() {
    if (!configuration.data?.chat_configured || configuration.error) return;
    await action.run(async () => {
      const result = await api<RecordItem>("/briefings", {
        method: "POST",
        body: "{}",
      });
      setBriefing(result);
    });
  }
  return (
    <>
      <PageHeader
        eyebrow={now
          .toLocaleDateString(locale, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          .toUpperCase()}
        title={t("{greeting}, {name}.", {
          greeting,
          name: user.name || user.email.split("@")[0],
        })}
        subtitle={t("A clear view of your day. A little room to breathe.")}
      >
        <Button variant="secondary" onClick={() => setEditor(true)}>
          <Plus size={16} /> {t("Add a task")}{" "}
        </Button>
      </PageHeader>
      <Failure
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      <ErrorText text={action.error} />
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <section className="day-hero">
            <div className="hero-content">
              <span className="hero-label">
                <Sparkles size={14} /> {t("YOUR DAILY PERSPECTIVE")}{" "}
              </span>
              <h2>
                {t("A more intentional day")} <br />
                {t("starts with a little clarity.")}{" "}
              </h2>
              <p>
                {data?.briefing
                  ? t(
                      "Your latest briefing brings the important things together.",
                    )
                  : t(
                      "Let your assistant connect the dots between your plans, priorities and what matters to you.",
                    )}
              </p>
              {configuration.data?.chat_configured && !configuration.error ? (
                <Button
                  variant="secondary"
                  onClick={() => void generate()}
                  disabled={action.pending}
                >
                  {action.pending ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {t("Generate my briefing")} <ArrowUpRight size={15} />
                </Button>
              ) : configuration.isPending ? (
                <Button variant="secondary" disabled>
                  <LoaderCircle size={15} className="spin" />{" "}
                  {t("Reading AI configuration")}{" "}
                </Button>
              ) : (
                <Link
                  className="briefing-setup-link"
                  href="/settings?setup=1#chat-configuration"
                >
                  {t("Configure your chat model to generate a briefing")}{" "}
                  <ArrowUpRight size={15} />
                </Link>
              )}
              <span className="hero-footnote">
                {t("From your tasks, calendar & confirmed memories")}{" "}
              </span>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-1" />
              <div className="orbit orbit-2" />
              <div className="orbit orbit-3" />
              <div className="orbit-star">
                <Compass size={47} strokeWidth={0.8} />
              </div>
              <span className="orbit-spark spark-1">✦</span>
              <span className="orbit-spark spark-2">✧</span>
              <i className="orbit-planet" />
            </div>
          </section>
          <div className="stats-grid">
            {[
              {
                label: t("Open tasks"),
                value: data?.stats.tasks,
                icon: CheckCircle2,
                note: t("One thing at a time"),
                route: "tasks",
              },
              {
                label: t("Memories"),
                value: data?.stats.memories,
                icon: Brain,
                note: t("Your personal context"),
                route: "memory",
              },
              {
                label: t("Automations"),
                value: data?.stats.automations,
                icon: Zap,
                note: t("Working in the background"),
                route: "automations",
              },
            ].map(({ label, value, icon: Icon, note, route }) => (
              <Link href={`/${route}`} className="stat-card" key={label}>
                <div>
                  <span>{label}</span>
                  <Icon size={17} />
                </div>
                <strong>
                  {query.isPending ? "—" : (value ?? "—")}
                  <ArrowUpRight size={16} />
                </strong>
                <small>{note}</small>
              </Link>
            ))}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  <CheckCircle2 size={18} /> {t("In your focus")}{" "}
                </h2>
                <p>{t("A few things to move forward.")}</p>
              </div>
              <Link href="/tasks" className="text-link">
                {t("All tasks")} <ArrowRight size={14} />
              </Link>
            </div>
            {query.isPending ? (
              <Loading />
            ) : query.error ? (
              <p className="field-note">{t("Tasks could not be loaded.")}</p>
            ) : !data?.tasks.filter(
                (t) => !["done", "cancelled"].includes(t.status || ""),
              ).length ? (
              <Empty
                title={t("A little breathing room.")}
                text={t(
                  "Capture something you want to get done. We'll keep it in view.",
                )}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditor(true)}
                  >
                    <Plus size={14} /> {t("Add your first task")}{" "}
                  </Button>
                }
              />
            ) : (
              <div className="task-list">
                {data.tasks
                  .filter(
                    (t) => !["done", "cancelled"].includes(t.status || ""),
                  )
                  .slice(0, 5)
                  .map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      onEdit={() => {}}
                      onDelete={() => {}}
                      compact
                    />
                  ))}
              </div>
            )}
          </section>
          {(briefing || data?.briefing) && (
            <section className="panel briefing-result">
              <span className="eyebrow">
                <Sparkles size={14} /> {t("YOUR BRIEFING")}{" "}
              </span>
              <h2>
                {(briefing || data?.briefing)?.title || t("A view of your day")}
              </h2>
              <div className="prose-content">
                {(briefing || data?.briefing)?.content}
              </div>
            </section>
          )}
          <section className="panel briefing-history">
            <details>
              <summary>
                <History size={16} /> {t("Previous briefings")}{" "}
                <span>{briefingHistory.data?.length || 0}</span>
              </summary>
              <Failure error={briefingHistory.error} />
              {briefingHistory.data?.length ? (
                briefingHistory.data.map((item) => (
                  <details className="briefing-history-item" key={item.id}>
                    <summary>
                      {item.title || t("Daily briefing")}
                      <time>
                        {dateLabel(item.created_at)} ·{" "}
                        {timeLabel(item.created_at)}
                      </time>
                    </summary>
                    <div className="prose-content">{item.content}</div>
                  </details>
                ))
              ) : (
                <p>{t("Your generated briefings will appear here.")}</p>
              )}
            </details>
          </section>
          <section className="assistant-banner">
            <span className="assistant-icon">
              <Sparkles size={24} />
            </span>
            <div>
              <h3>{t("Thinking out loud is a good place to start.")}</h3>
              <p>
                {t("Make a plan, untangle an idea, or simply ask a question.")}
              </p>
            </div>
            <Link
              href="/chat"
              className="circle-arrow"
              aria-label={t("Open AI assistant")}
            >
              <ArrowUpRight size={22} />
            </Link>
          </section>
        </div>
        <aside className="dashboard-aside">
          <section className="panel calendar-preview">
            <div className="panel-heading">
              <h2>
                <CalendarDays size={17} /> {t("On the horizon")}{" "}
              </h2>
              <Link href="/calendar" aria-label={t("Open calendar")}>
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="mini-week">
              {Array.from({ length: 7 }, (_, i) => {
                const date = new Date(now);
                date.setDate(now.getDate() - now.getDay() + i);
                return (
                  <div
                    className={
                      date.toDateString() === now.toDateString() ? "today" : ""
                    }
                    key={i}
                  >
                    <span>
                      {date.toLocaleDateString(locale, { weekday: "narrow" })}
                    </span>
                    <strong>{date.getDate()}</strong>
                  </div>
                );
              })}
            </div>
            {query.isPending ? (
              <Loading />
            ) : query.error ? (
              <p className="field-note">
                {t("Calendar events could not be loaded.")}
              </p>
            ) : data?.events.length ? (
              <div className="agenda-list">
                {data.events.slice(0, 4).map((event) => (
                  <Link
                    className="agenda-item"
                    href="/calendar"
                    key={event.id}
                  >
                    <span className="agenda-time">
                      {event.all_day ? t("All day") : timeLabel(event.start_at)}
                    </span>
                    <div>
                      <strong>{event.title}</strong>
                      <small>{dateLabel(event.start_at)}</small>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="quiet-empty">
                <CalendarDays size={23} strokeWidth={1.2} />
                <strong>{t("No local events in the next seven days.")}</strong>
                <p>
                  {t(
                    "Add an event to your PersonalOS calendar to plan your day.",
                  )}
                </p>
                <Link href="/calendar">
                  {t("Open calendar")} <ArrowRight size={13} />
                </Link>
              </div>
            )}
          </section>
          <section className="panel memory-preview">
            <span className="small-icon">
              <Brain size={20} />
            </span>
            <h2>
              {t("A second brain,")} <br />
              {t("with your permission.")}{" "}
            </h2>
            <p>
              {t(
                "Keep the context that matters. You decide what stays, changes, or goes.",
              )}{" "}
            </p>
            <Link href="/memory" className="text-link">
              {t("Explore your memory")} <ArrowRight size={14} />
            </Link>
            <div className="memory-note">
              <LockKeyhole size={13} />{" "}
              {t("Nothing remembered without your say.")}{" "}
            </div>
          </section>
          <div className="day-note">
            <span>✳</span>
            <p>
              {t("Progress doesn’t have to be loud.")} <br />
              {t("One meaningful thing is enough.")}{" "}
            </p>
            <small>{t("A LITTLE REMINDER")}</small>
          </div>
          {!!data?.stats.approvals && (
            <Link className="approval-nudge" href="/activity">
              <ShieldCheck size={20} />
              <span>
                {t(
                  data.stats.approvals === 1
                    ? "{count} action waiting for your approval"
                    : "{count} actions waiting for your approval",
                  { count: data.stats.approvals },
                )}
              </span>
              <ArrowRight size={16} />
            </Link>
          )}
        </aside>
      </div>
      {editor && (
        <ResourceEditor kind="tasks" onClose={() => setEditor(false)} />
      )}
    </>
  );
}

function TaskRow({
  item,
  onEdit,
  onDelete,
  compact = false,
}: {
  item: RecordItem;
  onEdit: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const { t, dateLabel, errorText } = useI18n();
  const action = useAction();
  return (
    <div className={`task-row ${item.status === "done" ? "task-done" : ""}`}>
      <button
        className="task-check"
        disabled={action.pending}
        aria-label={
          item.status === "done" ? t("Reopen task") : t("Complete task")
        }
        onClick={() => {
          void action.run(() =>
            api(`/tasks/${item.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: item.status === "done" ? "todo" : "done",
                version: item.version,
              }),
            }),
          );
        }}
      >
        {item.status === "done" ? (
          <Check size={16} />
        ) : (
          <Circle size={20} strokeWidth={1.3} />
        )}
      </button>
      <div className="task-copy">
        <strong>{item.title}</strong>
        {item.content && !compact && <p>{item.content}</p>}
        <div className="task-meta">
          <span className={`priority priority-${item.priority}`}>
            {t(item.priority || "medium")}
          </span>
          {item.due_at && (
            <span>
              <CalendarDays size={12} />
              {dateLabel(item.due_at)}
            </span>
          )}
          {!compact && <Badge status={item.status} />}
        </div>
        {action.error && (
          <span className="inline-error">{errorText(t(action.error))}</span>
        )}
      </div>
      {!compact && <RowActions onEdit={onEdit} onDelete={onDelete} />}
      {compact && (
        <Link href="/tasks" aria-label={t("View task")}>
          <ChevronRight size={17} />
        </Link>
      )}
    </div>
  );
}
export function TasksPage() {
  const { t } = useI18n();
  const query = useRecords("tasks");
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<RecordItem | "new">();
  const action = useAction();
  const records = (query.data || []).filter(
    (item) =>
      (filter === "all" ||
        (filter === "done"
          ? item.status === "done"
          : item.status !== "done" && item.status !== "cancelled")) &&
      (item.title || "").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow={t("MAKE SPACE FOR PROGRESS")}
        title={t("One thing at a time.")}
        subtitle={t("Get it out of your head and into a plan.")}
      >
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> {t("Add task")}{" "}
        </Button>
      </PageHeader>
      <div className="toolbar">
        <div className="tabs">
          {["open", "done", "all"].map((value) => (
            <button
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
              key={value}
            >
              {value === "open"
                ? t("To do")
                : value === "done"
                  ? t("Completed")
                  : t("All tasks")}
              <span>
                {query.isPending || query.error
                  ? "—"
                  : (query.data || []).filter(
                      (t) =>
                        value === "all" ||
                        (value === "done"
                          ? t.status === "done"
                          : !["done", "cancelled"].includes(t.status || "")),
                    ).length}
              </span>
            </button>
          ))}
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Find a task…")}
            aria-label={t("Find a task")}
          />
        </div>
      </div>
      <Failure
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      <ErrorText text={action.error} />
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <p className="field-note">{t("Tasks could not be loaded.")}</p>
        ) : records.length ? (
          records.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              onEdit={() => setEdit(item)}
              onDelete={() => {
                if (
                  confirm(t("Delete “{title}”?", { title: item.title || "" }))
                )
                  void action.run(() => remove("tasks", item, t));
              }}
            />
          ))
        ) : (
          <Empty
            icon={<CheckCircle2 size={29} strokeWidth={1.3} />}
            title={
              search
                ? t("No tasks found.")
                : filter === "done"
                  ? t("Your wins will live here.")
                  : t("Every good plan starts somewhere.")
            }
            text={
              search
                ? t("Try a different search or filter.")
                : t(
                    "Capture a task, set a priority, and take it one step at a time.",
                  )
            }
            action={
              <Button variant="secondary" onClick={() => setEdit("new")}>
                <Plus size={15} /> {t("Add a task")}{" "}
              </Button>
            }
          />
        )}
      </section>
      <div className="subtle-tip">
        <Sparkles size={15} /> {t("Prefer to think out loud?")}{" "}
        <Link href="/chat">
          {t("Ask your assistant to create a task")} <ArrowUpRight size={13} />
        </Link>
      </div>
      {edit && (
        <ResourceEditor
          kind="tasks"
          item={edit === "new" ? undefined : edit}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}

function useDebouncedSearch(value: string) {
  const [debounced, setDebounced] = useState(value.trim());
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [value]);
  return debounced;
}

export function MemoryPage() {
  const { t, dateLabel } = useI18n();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("q") || ""
      : "",
  );
  const debouncedSearch = useDebouncedSearch(search);
  const query = useQuery({
    queryKey: ["memory", debouncedSearch],
    queryFn: ({ signal }) =>
      apiAllPages<RecordItem>(
        `/memories?q=${encodeURIComponent(debouncedSearch)}`,
        signal,
      ),
  });
  const [edit, setEdit] = useState<RecordItem | "new">();
  const action = useAction();
  const records = (query.data || []).filter(
    (item) =>
      filter === "all" || item.status === filter || item.category === filter,
  );
  return (
    <>
      <PageHeader
        eyebrow={t("CONTEXT, WITH CONSENT")}
        title={t("A place for what matters.")}
        subtitle={t(
          "Your preferences, goals and important details. Always yours to control.",
        )}
      >
        <Button
          variant="secondary"
          onClick={() => {
            void action.run(downloadExport);
          }}
        >
          <ArrowDownToLine size={15} /> {t("Export")}{" "}
        </Button>
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> {t("Add memory")}{" "}
        </Button>
      </PageHeader>
      <div className="info-strip">
        <ShieldCheck size={20} />
        <div>
          <strong>{t("You choose what stays.")}</strong>
          <span>
            {" "}
            {t(
              "Suggestions wait for your confirmation before becoming long-term context.",
            )}{" "}
          </span>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {["all", "pending", "confirmed", "preference", "goal", "fact"].map(
            (value) => (
              <button
                key={value}
                className={filter === value ? "selected" : ""}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? t("All memories")
                  : value === "pending"
                    ? t("To review")
                    : t(value[0].toUpperCase() + value.slice(1))}
              </button>
            ),
          )}
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            placeholder={t("Search your memories…")}
            aria-label={t("Search memories")}
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <Failure error={query.error} retry={() => void query.refetch()} />
      <ErrorText text={action.error} />
      {query.isPending || search.trim() !== debouncedSearch ? (
        <Loading />
      ) : query.error ? (
        <p className="field-note">{t("Memories could not be loaded.")}</p>
      ) : !records.length ? (
        <section className="panel">
          <Empty
            icon={<Brain size={30} strokeWidth={1.3} />}
            title={
              debouncedSearch
                ? t("Nothing matched that memory.")
                : t("A fresh page for your story.")
            }
            text={
              debouncedSearch
                ? t(
                    "Try another phrase or category. Your search runs against your saved memories on the server.",
                  )
                : t(
                    "Add something worth remembering. Your assistant will use confirmed memories to understand you better.",
                  )
            }
            action={
              <Button variant="secondary" onClick={() => setEdit("new")}>
                <Plus size={14} /> {t("Save a memory")}{" "}
              </Button>
            }
          />
        </section>
      ) : (
        <div className="memory-grid">
          {records.map((item) => (
            <article key={item.id} className="panel memory-card">
              <div className="memory-card-top">
                <span className={`memory-category category-${item.category}`}>
                  <Brain size={13} />
                  {t(item.category?.replaceAll("_", " ") || "fact")}
                </span>
                <Badge status={item.status} />
              </div>
              <p>{item.content}</p>
              {typeof item.extra?.fact_key === "string" && (
                <div className="memory-topic">
                  <span>{t("Topic")}</span>
                  {item.extra.fact_key}
                </div>
              )}
              <div className="memory-source">
                <FileText size={12} />
                {item.source?.startsWith("chat:") ? (
                  <Link
                    className="text-link"
                    title={item.source}
                    href={`/chat?session=${encodeURIComponent(item.source.slice(5))}`}
                  >
                    {t("Source conversation")} <ArrowUpRight size={11} />
                  </Link>
                ) : (
                  <span title={item.source}>
                    {item.source === "Added manually by user"
                      ? t("Added manually by user")
                      : item.source || t("Added by you")}
                  </span>
                )}
                <time>{dateLabel(item.created_at)}</time>
              </div>
              {item.status === "pending" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => {
                    void action.run(() =>
                      api(`/memories/${item.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          status: "confirmed",
                          version: item.version,
                        }),
                      }),
                    );
                  }}
                >
                  <Check size={14} /> {t("Confirm memory")}{" "}
                </Button>
              )}
              <div className="memory-card-bottom">
                <span>
                  {t("Version")} {item.version}
                </span>
                <RowActions
                  onEdit={() => setEdit(item)}
                  onDelete={() => {
                    if (
                      confirm(
                        t(
                          "Delete this memory? It will stop being used for future recall.",
                        ),
                      )
                    )
                      void action.run(() => remove("memory", item, t));
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <ResourceEditor
          kind="memory"
          item={edit === "new" ? undefined : edit}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}

type CalendarView = "day" | "week" | "month";

const calendarPalette: CalendarColor[] = [
  "blue",
  "green",
  "orange",
  "red",
  "purple",
  "yellow",
  "pink",
  "teal",
  "brown",
  "gray",
];
const calendarColorLabels: Record<CalendarColor, string> = {
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  red: "Red",
  purple: "Purple",
  yellow: "Yellow",
  pink: "Pink",
  teal: "Teal",
  brown: "Brown",
  gray: "Gray",
};
/** The palette itself lives in globals.css; JSX only passes the variable. */
function calendarColorVar(color: CalendarColor) {
  return `var(--cal-palette-${color})`;
}
const calendarNameInputStyle: CSSProperties = {
  flex: "1 1 100%",
  minWidth: 0,
  height: "22px",
  padding: "0 6px",
  border: "1px solid var(--cal-hairline)",
  borderRadius: "6px",
  background: "var(--surface)",
  color: "var(--text)",
  font: "inherit",
};
const calendarViews: [CalendarView, string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];const eventScopes: [EventScope, string][] = [
  ["this", "This event"],
  ["following", "This and following events"],
  ["all", "All events"],
];
const repeatRules: [string, string][] = [
  ["", "Does not repeat"],
  ["FREQ=DAILY", "Every day"],
  ["FREQ=WEEKLY", "Every week"],
  ["FREQ=MONTHLY", "Every month"],
  ["FREQ=YEARLY", "Every year"],
];
/** Minutes before the event start; the worker turns these into in-app reminders. */
const eventReminders: [string, string][] = [
  ["", "No reminder"],
  ["0", "At start time"],
  ["5", "5 minutes before"],
  ["10", "10 minutes before"],
  ["30", "30 minutes before"],
  ["60", "1 hour before"],
  ["1440", "1 day before"],
];

const HOUR_HEIGHT = 48;
const SNAP_MINUTES = 15;
const DAY_MS = 86_400_000;

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
function addMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}
function startOfWeek(value: Date) {
  const day = startOfDay(value);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}
function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
function atMinutes(day: Date, minutes: number) {
  const value = startOfDay(day);
  value.setMinutes(minutes);
  return value;
}
function snapMinutes(minutes: number) {
  const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(24 * 60, snapped));
}
function monthDays(value: Date) {
  const first = startOfWeek(new Date(value.getFullYear(), value.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}
/** Compact Apple-style gutter label: `9 AM`, `12 PM`, no zero padding. */
function hourLabel(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}
function eventRange(item: CalendarEvent) {
  if (!item.start_at) return null;
  const start = new Date(item.start_at);
  if (Number.isNaN(start.getTime())) return null;
  const raw = item.end_at ? new Date(item.end_at) : start;
  const end =
    raw.getTime() > start.getTime()
      ? raw
      : new Date(start.getTime() + SNAP_MINUTES * 60_000);
  return { start, end };
}
function eventOverlapsDay(item: CalendarEvent, day: Date) {
  const range = eventRange(item);
  if (!range) return false;
  const dayStart = startOfDay(day).getTime();
  return range.end.getTime() > dayStart && range.start.getTime() < dayStart + DAY_MS;
}
function sortEvents(items: CalendarEvent[]) {
  return [...items].sort(
    (left, right) =>
      (left.start_at ? new Date(left.start_at).getTime() : 0) -
        (right.start_at ? new Date(right.start_at).getTime() : 0) ||
      left.id.localeCompare(right.id),
  );
}
function repeatLabel(rule?: string | null) {
  return (
    repeatRules.find(([value]) => !!value && !!rule?.includes(value))?.[1] ||
    "Does not repeat"
  );
}
function repeatValue(rule?: string | null) {
  return (
    repeatRules.find(([value]) => !!value && !!rule?.includes(value))?.[0] || ""
  );
}
function eventKey(item: CalendarEvent) {
  return `${item.id}|${item.occurrence_start || ""}`;
}

interface PositionedEvent {
  item: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  short: boolean;
}
function positionEvents(items: CalendarEvent[], day: Date): PositionedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const blocks = sortEvents(items).flatMap((item) => {
    const range = eventRange(item);
    if (!range) return [];
    const from = Math.max(0, (range.start.getTime() - dayStart) / 60_000);
    const to = Math.min(24 * 60, (range.end.getTime() - dayStart) / 60_000);
    if (to <= 0 || from >= 24 * 60) return [];
    return [{ item, from, to: Math.max(to, from + SNAP_MINUTES) }];
  });
  const positioned: PositionedEvent[] = [];
  let cluster: { block: (typeof blocks)[number]; column: number }[] = [];
  let clusterEnd = -1;
  function flush() {
    if (!cluster.length) return;
    const columns = Math.max(...cluster.map((entry) => entry.column)) + 1;
    for (const entry of cluster) {
      const length = entry.block.to - entry.block.from;
      positioned.push({
        item: entry.block.item,
        top: (entry.block.from / 60) * HOUR_HEIGHT,
        height: Math.max((length / 60) * HOUR_HEIGHT, 12),
        left: (entry.column * 100) / columns,
        width: 100 / columns,
        short: length <= 30,
      });
    }
    cluster = [];
    clusterEnd = -1;
  }
  for (const block of blocks) {
    if (cluster.length && block.from >= clusterEnd) flush();
    const used = new Set(
      cluster
        .filter((entry) => entry.block.to > block.from)
        .map((entry) => entry.column),
    );
    let column = 0;
    while (used.has(column)) column += 1;
    cluster.push({ block, column });
    clusterEnd = Math.max(clusterEnd, block.to);
  }
  flush();
  return positioned;
}
async function loadCalendarEvents(
  start: Date,
  end: Date,
  timezone: string,
  signal: AbortSignal,
) {
  const records = new Map<string, CalendarEvent>();
  const pageSize = 200;
  let offset = 0;
  // Publish only the complete window; a later page failure must not make a
  // partially loaded calendar look like complete availability.
  while (true) {
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      timezone,
      limit: String(pageSize),
      offset: String(offset),
    });
    const page = await api<CalendarEvent[]>(`/events?${params}`, { signal });
    for (const item of page) records.set(eventKey(item), item);
    if (page.length < pageSize) return Array.from(records.values());
    offset += page.length;
  }
}
function useCalendars(enabled = true) {
  return useQuery({
    queryKey: ["calendars"],
    enabled,
    queryFn: ({ signal }) =>
      api<{ items: CalendarItem[] }>("/calendars", { signal }),
  });
}

export function CalendarPage() {
  const { t, locale, dateLabel, timeLabel } = useI18n();
  const action = useAction();
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [editor, setEditor] = useState<{
    item?: CalendarEvent;
    start?: Date;
    end?: Date;
  }>();
  const [popover, setPopover] = useState<{
    item: CalendarEvent;
    x: number;
    y: number;
  }>();
  const [scopeTarget, setScopeTarget] = useState<CalendarEvent>();
  const [moveTarget, setMoveTarget] = useState<{
    item: CalendarItem;
    to: string;
  }>();
  const [bellOpen, setBellOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const bellPanelRef = useRef<HTMLDivElement>(null);
  const timezone = browserTimezone();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!bellOpen) return;
    function down(event: MouseEvent) {
      const target = event.target as Node;
      if (bellRef.current?.contains(target)) return;
      if (bellPanelRef.current?.contains(target)) return;
      setBellOpen(false);
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") setBellOpen(false);
    }
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [bellOpen]);
  const days =
    view === "month"
      ? monthDays(cursor)
      : view === "week"
        ? Array.from({ length: 7 }, (_, index) =>
            addDays(startOfWeek(cursor), index),
          )
        : [startOfDay(cursor)];
  const windowEnd = addDays(days[days.length - 1], 1);
  const queryStart = addDays(days[0], -1);
  const calendars = useCalendars();
  const calendarList = calendars.data?.items || [];
  const events = useQuery({
    queryKey: [
      "calendar-events",
      queryStart.toISOString(),
      windowEnd.toISOString(),
      timezone,
    ],
    queryFn: ({ signal }) =>
      loadCalendarEvents(queryStart, windowEnd, timezone, signal),
  });
  const notifications = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: ({ signal }) =>
      api<{ items: NotificationItem[]; unread: number }>(
        "/notifications?status=unread",
        { signal },
      ),
    refetchInterval: 60_000,
  });
  const visible = new Set(
    calendarList.filter((item) => item.visible).map((item) => item.id),
  );
  const records = (events.data || []).filter(
    (item) =>
      !item.calendar_id ||
      !calendarList.length ||
      visible.has(item.calendar_id),
  );
  const agenda = sortEvents(
    records.filter((item) => eventOverlapsDay(item, selected)),
  );
  const unread = notifications.data?.unread || 0;
  const reminders = notifications.data?.items || [];
  function colorOf(item: CalendarEvent) {
    return calendarColorVar(
      calendarList.find((calendar) => calendar.id === item.calendar_id)
        ?.color || "blue",
    );
  }
  function focusDay(day: Date) {
    setCursor(day);
    setSelected(day);
  }
  function shiftPeriod(step: number) {
    const next =
      view === "month"
        ? addMonths(cursor, step)
        : view === "week"
          ? addDays(cursor, step * 7)
          : addDays(cursor, step);
    setCursor(next);
    if (view === "day") setSelected(next);
  }
  function changeView(next: CalendarView) {
    setView(next);
    setBellOpen(false);
    if (next === "day") setSelected(cursor);
  }
  function createEvent(day: Date, from = 9 * 60, to = 10 * 60) {
    setPopover(undefined);
    setSelected(startOfDay(day));
    setEditor({ start: atMinutes(day, from), end: atMinutes(day, to) });
  }
  function openEvent(item: CalendarEvent, event: { clientX: number; clientY: number }) {
    setPopover({ item, x: event.clientX, y: event.clientY });
  }
  async function removeEvent(item: CalendarEvent, scope: EventScope) {
    const params = new URLSearchParams({ scope });
    if (scope !== "all" && item.occurrence_start)
      params.set("occurrence_start", item.occurrence_start);
    await api(`/events/${item.id}?${params.toString()}`, { method: "DELETE" });
  }
  function askDelete(item: CalendarEvent) {
    setPopover(undefined);
    if (item.recurring) {
      setScopeTarget(item);
      return;
    }
    if (!confirm(t("Delete “{title}”?", { title: item.title || "" }))) return;
    void action.run(() => removeEvent(item, "all"));
  }
  async function removeCalendar(item: CalendarItem, moveTo?: string) {
    await api(
      `/calendars/${item.id}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ""}`,
      { method: "DELETE" },
    );
  }
  function askDeleteCalendar(item: CalendarItem) {
    if (item.is_default) {
      alert(t("The default calendar can’t be deleted."));
      return;
    }
    if (!confirm(t("Delete the “{name}” calendar?", { name: item.name })))
      return;
    void action.run(async () => {
      try {
        await removeCalendar(item);
      } catch (error) {
        const target = calendarList.find(
          (calendar) => calendar.id !== item.id,
        );
        if (error instanceof ApiError && error.status === 409 && target) {
          setMoveTarget({ item, to: target.id });
          return;
        }
        throw error;
      }
    });
  }
  const periodLabel =
    view === "month"
      ? cursor.toLocaleDateString(locale, { month: "long", year: "numeric" })
      : view === "week"
        ? `${days[0].toLocaleDateString(locale, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`
        : cursor.toLocaleDateString(locale, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });
  return (
    <>
      <PageHeader
        eyebrow={t("TIME, THOUGHTFULLY SPENT")}
        title={t("Make room in your day.")}
        subtitle={t("A little structure, a little breathing room.")}
      />
      <div className={`cal-shell${drawerOpen ? " is-sidebar-open" : ""}`}>
        <CalendarSidebar
          cursor={cursor}
          selected={selected}
          now={now}
          calendars={calendarList}
          error={calendars.error}
          onFocus={focusDay}
          onToggle={(item) => {
            void action.run(() =>
              api(`/calendars/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify({ visible: !item.visible }),
              }),
            );
          }}
          onCreate={(name, color) =>
            action.run(() =>
              api("/calendars", {
                method: "POST",
                body: JSON.stringify({ name, color }),
              }),
            )
          }
          onUpdate={(item, patch) =>
            action.run(() =>
              api(`/calendars/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify(patch),
              }),
            )
          }
          onDelete={askDeleteCalendar}
        />
        <div className="cal-main">
          <div className="cal-toolbar">
            <button
              type="button"
              className="cal-nav-btn cal-sidebar-toggle"
              aria-label={t("Calendars")}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(!drawerOpen)}
            >
              <Menu size={17} />
            </button>
            <h2 className="cal-title">{periodLabel}</h2>
            <div className="cal-nav">
              <button
                type="button"
                className="cal-nav-btn"
                aria-label={t("Previous")}
                onClick={() => shiftPeriod(-1)}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                className="cal-nav-today"
                onClick={() => focusDay(new Date())}
              >
                {t("Today")}
              </button>
              <button
                type="button"
                className="cal-nav-btn"
                aria-label={t("Next")}
                onClick={() => shiftPeriod(1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="cal-segmented">
              {calendarViews.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={view === value ? "is-active" : ""}
                  aria-pressed={view === value}
                  onClick={() => changeView(value)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="cal-bell"
              ref={bellRef}
              aria-label={t("Reminders")}
              aria-expanded={bellOpen}
              onClick={() => setBellOpen(!bellOpen)}
            >
              <Bell size={17} />
              {unread > 0 && <span className="cal-bell-count">{unread}</span>}
            </button>
            {bellOpen && (
              <NotificationPanel
                items={reminders}
                unread={unread}
                pending={action.pending}
                error={notifications.error}
                panelRef={bellPanelRef}
                onRead={(item) => {
                  void action.run(() =>
                    api(`/notifications/${item.id}/read`, { method: "POST" }),
                  );
                }}
                onReadAll={() => {
                  void action.run(() =>
                    api("/notifications/read-all", { method: "POST" }),
                  );
                }}
              />
            )}
            <button
              type="button"
              className="cal-new"
              onClick={() => createEvent(selected)}
            >
              <Plus size={15} /> {t("New event")}
            </button>
          </div>
          {events.error && (
            <div className="error-banner" role="alert">
              <span>{t("Calendar events could not be loaded.")}</span>
              <button
                onClick={() => {
                  void events.refetch();
                }}
              >
                {t("Try again")} <RefreshCw size={13} />
              </button>
            </div>
          )}
          <ErrorText text={action.error} />
          <div className="cal-body">
            {events.isPending ? (
              <Loading />
            ) : events.error ? (
              <p className="field-note">
                {t("Calendar events could not be loaded.")}
              </p>
            ) : view === "month" ? (
              <MonthView
                cursor={cursor}
                days={days}
                selected={selected}
                now={now}
                records={records}
                colorOf={colorOf}
                onFocus={focusDay}
                onOpen={openEvent}
                onCreate={(day) => createEvent(day)}
              />
            ) : (
              <TimeGridView
                days={days}
                now={now}
                locale={locale}
                timeText={timeLabel}
                records={records}
                colorOf={colorOf}
                onOpen={openEvent}
                onCreate={createEvent}
              />
            )}
          </div>
          <section className="panel day-agenda">
            <span className="eyebrow">{t("YOUR DAY")}</span>
            <h2>
              {selected.toLocaleDateString(locale, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h2>
            {events.isPending ? (
              <Loading />
            ) : events.error ? (
              <p className="field-note">
                {t("Calendar events could not be loaded.")}
              </p>
            ) : agenda.length ? (
              agenda.map((item) => (
                <article className="event-card" key={eventKey(item)}>
                  <span className="eyebrow">
                    {item.all_day ? (
                      t("All day")
                    ) : (
                      <>
                        {timeLabel(item.start_at)} — {timeLabel(item.end_at)}
                      </>
                    )}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.content}</p>
                  <Badge status={item.provider || "local"} />
                  <RowActions
                    onEdit={() => setEditor({ item })}
                    onDelete={() => askDelete(item)}
                  />
                </article>
              ))
            ) : (
              <Empty
                icon={<CalendarDays size={26} />}
                title={t("A clear stretch of time.")}
                text={t(
                  "There are no events on this day. Add something intentional.",
                )}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => createEvent(selected)}
                  >
                    <Plus size={14} /> {t("Add event")}
                  </Button>
                }
              />
            )}
          </section>
        </div>
      </div>
      {popover && (
        <EventPopover
          item={popover.item}
          point={popover}
          date={dateLabel(popover.item.start_at, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
          color={colorOf(popover.item)}
          timeText={timeLabel}
          onClose={() => setPopover(undefined)}
          onEdit={() => {
            setEditor({ item: popover.item });
            setPopover(undefined);
          }}
          onDelete={() => askDelete(popover.item)}
        />
      )}
      {scopeTarget && (
        <div className="modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-scope-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{t("REPEATING EVENT")}</span>
                <h2 id="calendar-scope-title">
                  {t("This event repeats. Choose which events to delete.")}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Close")}
                onClick={() => setScopeTarget(undefined)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              {scopeTarget.title} ·{" "}
              {dateLabel(scopeTarget.occurrence_start || scopeTarget.start_at)}
            </p>
            <ErrorText text={action.error} />
            <div className="modal-actions">
              {eventScopes.map(([scope, label]) => (
                <Button
                  key={scope}
                  variant={scope === "all" ? "ghost" : "secondary"}
                  className={scope === "all" ? "cal-pop-danger" : undefined}
                  disabled={action.pending}
                  onClick={() => {
                    void action.run(async () => {
                      await removeEvent(scopeTarget, scope);
                      setScopeTarget(undefined);
                    });
                  }}
                >
                  {t(label)}
                </Button>
              ))}
            </div>
          </section>
        </div>
      )}
      {moveTarget && (
        <div className="modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-move-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{t("MOVE EVENTS")}</span>
                <h2 id="calendar-move-title">
                  {t("“{name}” still has events.", {
                    name: moveTarget.item.name,
                  })}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Close")}
                onClick={() => setMoveTarget(undefined)}
              >
                <X size={20} />
              </button>
            </div>
            <label>
              {t("Move events to")}{" "}
              <select
                value={moveTarget.to}
                onChange={(event) =>
                  setMoveTarget({ ...moveTarget, to: event.target.value })
                }
              >
                {calendarList
                  .filter((calendar) => calendar.id !== moveTarget.item.id)
                  .map((calendar) => (
                    <option value={calendar.id} key={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
              </select>
            </label>
            <ErrorText text={action.error} />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setMoveTarget(undefined)}>
                {t("Cancel")}
              </Button>
              <Button
                disabled={action.pending}
                onClick={() => {
                  void action.run(async () => {
                    await removeCalendar(moveTarget.item, moveTarget.to);
                    setMoveTarget(undefined);
                  });
                }}
              >
                <Trash2 size={15} /> {t("Move and delete")}
              </Button>
            </div>
          </section>
        </div>
      )}
      {editor && (
        <ResourceEditor
          kind="calendar"
          item={editor.item}
          initial={
            editor.start && editor.end
              ? {
                  start_at: editor.start.toISOString(),
                  end_at: editor.end.toISOString(),
                  calendar_id:
                    calendarList.find((calendar) => calendar.is_default)?.id ||
                    calendarList[0]?.id,
                }
              : undefined
          }
          onClose={() => setEditor(undefined)}
        />
      )}
    </>
  );
}

function ColorSwatches({
  value,
  onChange,
}: {
  value: CalendarColor;
  onChange: (color: CalendarColor) => void;
}) {
  const { t } = useI18n();
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {calendarPalette.map((color) => (
        <button
          type="button"
          key={color}
          className="cal-dot"
          aria-label={t(calendarColorLabels[color])}
          aria-pressed={value === color}
          style={
            {
              "--cal-color": calendarColorVar(color),
              width: "14px",
              height: "14px",
              padding: "0",
              border: "0",
              borderRadius: "50%",
              outline: value === color ? "2px solid var(--cal-color)" : "none",
              outlineOffset: "2px",
              cursor: "pointer",
            } as CSSProperties
          }
          onClick={() => onChange(color)}
        />
      ))}
    </span>
  );
}

function CalendarSidebar({
  cursor,
  selected,
  now,
  calendars,
  error,
  onFocus,
  onToggle,
  onCreate,
  onUpdate,
  onDelete,
}: {
  cursor: Date;
  selected: Date;
  now: Date;
  calendars: CalendarItem[];
  error: Error | null;
  onFocus: (day: Date) => void;
  onToggle: (item: CalendarItem) => void;
  onCreate: (name: string, color: CalendarColor) => Promise<boolean>;
  onUpdate: (
    item: CalendarItem,
    patch: { name?: string; color?: CalendarColor },
  ) => Promise<boolean>;
  onDelete: (item: CalendarItem) => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [color, setColor] = useState<CalendarColor>("blue");
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const grid = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );
  return (
    <aside className="cal-sidebar">
      <div className="cal-mini">
        <div className="cal-mini-head">
          <button
            type="button"
            className="cal-nav-btn"
            aria-label={t("Previous month")}
            onClick={() => onFocus(addMonths(cursor, -1))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {cursor.toLocaleDateString(locale, {
              month: "long",
              year: "numeric",
            })}
          </span>
          <button
            type="button"
            className="cal-nav-btn"
            aria-label={t("Next month")}
            onClick={() => onFocus(addMonths(cursor, 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="cal-mini-grid">
          {grid.slice(0, 7).map((day) => (
            <span key={day.toISOString()}>
              {day.toLocaleDateString(locale, { weekday: "narrow" })}
            </span>
          ))}
          {grid.map((day) => (
            <button
              type="button"
              key={day.toISOString()}
              className={`cal-mini-cell${sameDay(day, now) ? " is-today" : ""}${day.getMonth() !== cursor.getMonth() ? " is-outside" : ""}${sameDay(day, selected) ? " is-selected" : ""}`}
              onClick={() => onFocus(day)}
            >
              {day.getDate()}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="field-note">{t("Calendars could not be loaded.")}</p>
      )}
      <div className="cal-lists">
        {calendars.map((item) =>
          editing === item.id ? (
            <form
              className="cal-list-item"
              key={item.id}
              style={{ flexWrap: "wrap" }}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void onUpdate(item, {
                  name: String(data.get("name") || "").trim(),
                  color,
                }).then((ok) => {
                  if (ok) setEditing(undefined);
                });
              }}
            >
              <input
                name="name"
                defaultValue={item.name}
                aria-label={t("Calendar name")}
                style={calendarNameInputStyle}
                required
                maxLength={120}
              />
              <ColorSwatches value={color} onChange={setColor} />
              <span className="cal-list-actions">
                <button
                  type="submit"
                  className="icon-button"
                  aria-label={t("Save changes")}
                >
                  <Check size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Cancel")}
                  onClick={() => setEditing(undefined)}
                >
                  <X size={15} />
                </button>
              </span>
            </form>
          ) : (
            <div
              className={`cal-list-item${item.visible ? "" : " is-off"}`}
              key={item.id}
            >
              <input
                type="checkbox"
                checked={item.visible}
                aria-label={item.name}
                style={{ accentColor: calendarColorVar(item.color) }}
                onChange={() => onToggle(item)}
              />
              <span
                className="cal-dot"
                style={{ "--cal-color": calendarColorVar(item.color) } as CSSProperties}
              />
              <span className="cal-list-name">{item.name}</span>
              <span className="cal-list-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Edit")}
                  onClick={() => {
                    setEditing(item.id);
                    setColor(item.color);
                  }}
                >
                  <Edit3 size={14} />
                </button>
                {!item.is_default && (
                  <button
                    type="button"
                    className="icon-button delete"
                    aria-label={t("Delete")}
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </div>
          ),
        )}
        {adding ? (
          <form
            className="cal-list-item"
            style={{ flexWrap: "wrap" }}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const name = String(data.get("name") || "").trim();
              if (!name) return;
              void onCreate(name, color).then((ok) => {
                if (ok) setAdding(false);
              });
            }}
          >
            <input
              name="name"
              aria-label={t("Calendar name")}
              placeholder={t("Calendar name")}
              style={calendarNameInputStyle}
              autoFocus
              required
              maxLength={120}
            />
            <ColorSwatches value={color} onChange={setColor} />
            <span className="cal-list-actions">
              <button
                type="submit"
                className="icon-button"
                aria-label={t("Add calendar")}
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Cancel")}
                onClick={() => setAdding(false)}
              >
                <X size={15} />
              </button>
            </span>
          </form>
        ) : (
          <button
            type="button"
            className="cal-list-add"
            onClick={() => {
              setAdding(true);
              setColor("blue");
            }}
          >
            <Plus size={14} /> {t("New calendar")}
          </button>
        )}
      </div>
    </aside>
  );
}

function NotificationPanel({
  items,
  unread,
  pending,
  error,
  panelRef,
  onRead,
  onReadAll,
}: {
  items: NotificationItem[];
  unread: number;
  pending: boolean;
  error: Error | null;
  panelRef: React.Ref<HTMLDivElement>;
  onRead: (item: NotificationItem) => void;
  onReadAll: () => void;
}) {
  const { t, timeLabel } = useI18n();
  return (
    <div
      className="cal-bell-panel"
      ref={panelRef}
      role="dialog"
      aria-label={t("Reminders")}
    >
      <div className="cal-pop-head">
        <h2>{t("Reminders")}</h2>
        {unread > 0 && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onReadAll}>
            {t("Mark all as read")}
          </Button>
        )}
      </div>
      <Failure error={error} />
      {items.length ? (
        items.map((item) => (
          <div
            className={`cal-notif${item.status === "unread" ? " is-unread" : ""}`}
            key={item.id}
          >
            <strong>{item.title}</strong>
            {item.body && <p>{item.body}</p>}
            <small>{timeLabel(item.due_at)}</small>
            <button
              type="button"
              className="icon-button"
              aria-label={t("Mark as read")}
              onClick={() => onRead(item)}
            >
              <Check size={14} />
            </button>
          </div>
        ))
      ) : (
        <p className="field-note">{t("No unread reminders.")}</p>
      )}
    </div>
  );
}

function EventPopover({
  item,
  point,
  date,
  color,
  timeText,
  onClose,
  onEdit,
  onDelete,
}: {
  item: CalendarEvent;
  point: { x: number; y: number };
  date: string;
  color: string;
  timeText: (value?: string) => string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function down(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const width = 288;
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight;
  const left = Math.max(12, Math.min(point.x, viewportWidth - width - 12));
  const top = Math.max(12, Math.min(point.y + 8, viewportHeight - 260));
  return (
    <div
      className="cal-pop"
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={t("Event details")}
      style={{ position: "fixed", top, left, width, maxWidth: "calc(100vw - 24px)" }}
    >
      <div className="cal-pop-head">
        <span className="cal-dot" style={{ "--cal-color": color } as CSSProperties} />
        <h2>{item.title || t("Untitled event")}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Close")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="cal-pop-meta">
        <span>{date}</span>
        <span>
          {item.all_day
            ? t("All day")
            : `${timeText(item.start_at)} — ${timeText(item.end_at)}`}
        </span>
        {item.location && <span>{item.location}</span>}
        {item.recurring && <span>{t(repeatLabel(item.rrule))}</span>}
        {item.content && <p>{item.content}</p>}
      </div>
      <div className="cal-pop-actions">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          {t("Edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="cal-pop-danger"
          onClick={onDelete}
        >
          {t("Delete")}
        </Button>
      </div>
    </div>
  );
}

function MonthView({
  cursor,
  days,
  selected,
  now,
  records,
  colorOf,
  onFocus,
  onOpen,
  onCreate,
}: {
  cursor: Date;
  days: Date[];
  selected: Date;
  now: Date;
  records: CalendarEvent[];
  colorOf: (item: CalendarEvent) => string;
  onFocus: (day: Date) => void;
  onOpen: (item: CalendarEvent, event: { clientX: number; clientY: number }) => void;
  onCreate: (day: Date) => void;
}) {
  const { t, locale, timeLabel } = useI18n();
  const firstDay = days[0];
  return (
    <section className="cal-month">
      <div className="cal-month-head">
        {Array.from({ length: 7 }, (_, index) => addDays(firstDay, index)).map(
          (day) => (
            <span key={day.toISOString()}>
              {day.toLocaleDateString(locale, { weekday: "short" })}
            </span>
          ),
        )}
      </div>
      <div className="cal-month-grid">
        {days.map((day) => {
          const dayEvents = sortEvents(
            records.filter((item) => eventOverlapsDay(item, day)),
          );
          return (
            <div
              key={day.toISOString()}
              className={`cal-month-cell${day.getMonth() !== cursor.getMonth() ? " is-other-month" : ""}${sameDay(day, now) ? " is-today" : ""}${sameDay(day, selected) ? " is-selected" : ""}`}
              onClick={(event) => {
                if (event.target === event.currentTarget) onCreate(day);
              }}
            >
              <button
                type="button"
                className="cal-day-number"
                onClick={() => onFocus(day)}
              >
                {day.getDate()}
              </button>
              {dayEvents.slice(0, 3).map((item) => (
                <button
                  type="button"
                  key={eventKey(item)}
                  className="cal-chip"
                  style={{ "--cal-color": colorOf(item) } as CSSProperties}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(item, event);
                  }}
                >
                  {item.all_day ? null : <span>{timeLabel(item.start_at)}</span>}
                  <strong>{item.title || t("Untitled event")}</strong>
                </button>
              ))}
              {dayEvents.length > 3 && (
                <button
                  type="button"
                  className="cal-chip-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFocus(day);
                  }}
                >
                  {t("+{count} more", { count: dayEvents.length - 3 })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TimeGridView({
  days,
  now,
  locale,
  timeText,
  records,
  colorOf,
  onOpen,
  onCreate,
}: {
  days: Date[];
  now: Date;
  locale: string;
  timeText: (value?: string) => string;
  records: CalendarEvent[];
  colorOf: (item: CalendarEvent) => string;
  onOpen: (item: CalendarEvent, event: { clientX: number; clientY: number }) => void;
  onCreate: (day: Date, from: number, to: number) => void;
}) {
  const { t } = useI18n();
  const origin = useRef<
    { day: number; top: number; y: number; minute: number } | undefined
  >(undefined);
  const [drag, setDrag] = useState<{
    day: number;
    from: number;
    to: number;
    moved: boolean;
  }>();
  const latest = useRef<
    | { day: number; from: number; to: number; moved: boolean }
    | undefined
  >(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef({ days, now });
  useEffect(() => {
    rangeRef.current = { days, now };
  });
  // Park the viewport on the current hour (or 08:00) whenever the day range
  // changes, so the grid never opens on an empty 00:00–08:00 stretch.
  const rangeKey = `${days[0].toISOString()}:${days.length}`;
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const current = rangeRef.current;
    const hoursToday = current.days.findIndex((day) => sameDay(day, current.now));
    const anchor =
      hoursToday >= 0
        ? Math.max(0, current.now.getHours() - 1) * 60
        : 8 * 60;
    box.scrollTop = (anchor / 60) * HOUR_HEIGHT;
  }, [rangeKey]);
  useEffect(() => {
    if (!drag) return;
    function move(event: PointerEvent) {
      const start = origin.current;
      if (!start) return;
      const minute = snapMinutes(
        ((event.clientY - start.top) / HOUR_HEIGHT) * 60,
      );
      const next = {
        day: start.day,
        from: Math.min(start.minute, minute),
        to: Math.max(start.minute, minute),
        moved: latest.current?.moved === true || Math.abs(event.clientY - start.y) > 4,
      };
      latest.current = next;
      setDrag(next);
    }
    function up() {
      const start = origin.current;
      const current = latest.current;
      origin.current = undefined;
      latest.current = undefined;
      setDrag(undefined);
      if (!start) return;
      const day = days[Math.min(start.day, days.length - 1)];
      if (current?.moved && current.to - current.from >= SNAP_MINUTES)
        onCreate(day, current.from, current.to);
      else onCreate(day, start.minute, start.minute + 30);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, days, onCreate]);
  const columns = days.length;
  const todayIndex = days.findIndex((day) => sameDay(day, now));
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
  function begin(day: number, event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = snapMinutes(((event.clientY - rect.top) / HOUR_HEIGHT) * 60);
    origin.current = {
      day,
      top: rect.top,
      y: event.clientY,
      minute: Math.min(minute, 24 * 60 - SNAP_MINUTES),
    };
    latest.current = { day, from: minute, to: minute, moved: false };
    setDrag({ day, from: minute, to: minute, moved: false });
  }
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return (
    <section className="cal-timegrid">
      <div className="cal-timegrid-head">
        <span />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={sameDay(day, now) ? "is-today" : ""}
          >
            <span>{day.toLocaleDateString(locale, { weekday: "short" })}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}
      </div>
      <div className="cal-allday-row">
        <span>{t("All day")}</span>
        {days.map((day) => (
          <div key={day.toISOString()}>
            {sortEvents(
              records.filter(
                (item) => item.all_day && eventOverlapsDay(item, day),
              ),
            ).map((item) => (
              <button
                type="button"
                key={eventKey(item)}
                className="cal-allday-chip"
                style={{ "--cal-color": colorOf(item) } as CSSProperties}
                onClick={(event) => onOpen(item, event)}
              >
                {item.title || t("Untitled event")}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-gutter">
          {hours.map((hour) => (
            <div
              className="cal-gutter-slot"
              key={hour}
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              {hour > 0 ? (
                <span style={{ letterSpacing: 0, whiteSpace: "nowrap" }}>
                  {hourLabel(hour)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {/* The ghost and now-line use column percentages, so this box anchors them. */}
        <div className="cal-cols" style={{ position: "relative" }}>
          {days.map((day, index) => (
            <div
              className="cal-col"
              key={day.toISOString()}
              onPointerDown={(event) => begin(index, event)}
            >
              {hours.map((hour) => (
                <div
                  className="cal-col-slot"
                  key={hour}
                  style={{ height: `${HOUR_HEIGHT}px` }}
                />
              ))}
              {positionEvents(
                records.filter(
                  (item) => !item.all_day && eventOverlapsDay(item, day),
                ),
                day,
              ).map((block) => (
                <button
                  type="button"
                  key={eventKey(block.item)}
                  className={`cal-event-block${block.short ? " is-short" : ""}`}
                  style={
                    {
                      "--cal-color": colorOf(block.item),
                      top: `${block.top}px`,
                      height: `${block.height}px`,
                      left: `calc(${block.left}% + 1px)`,
                      width: `calc(${block.width}% - 2px)`,
                    } as CSSProperties
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(block.item, event);
                  }}
                >
                  <strong>{block.item.title || t("Untitled event")}</strong>
                  {block.short ? null : (
                    <span>{timeText(block.item.start_at)}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {todayIndex >= 0 && (
            <div
              className="cal-now-line"
              style={{
                top: `${nowTop}px`,
                left: `${(todayIndex * 100) / columns}%`,
                width: `${100 / columns}%`,
              }}
            />
          )}
          {drag?.moved && (
            <div
              className="cal-drag-ghost"
              style={{
                top: `${(drag.from / 60) * HOUR_HEIGHT}px`,
                height: `${Math.max(((drag.to - drag.from) / 60) * HOUR_HEIGHT, 12)}px`,
                left: `${(drag.day * 100) / columns}%`,
                width: `${100 / columns}%`,
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function AutomationsPage() {
  const { t, dateLabel, timeLabel } = useI18n();
  const query = useRecords("automations");
  const action = useAction();
  const [edit, setEdit] = useState<RecordItem | "new">();
  async function status(item: RecordItem, value: string) {
    await action.run(() =>
      api(`/automations/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: value, version: item.version }),
      }),
    );
  }
  return (
    <>
      <PageHeader
        eyebrow={t("LET THE LITTLE THINGS RUN")}
        title={t("A little help, on repeat.")}
        subtitle={t("Thoughtful routines that work quietly in the background.")}
      >
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> {t("Create automation")}{" "}
        </Button>
      </PageHeader>
      <div className="automation-intro">
        <span className="intro-symbol">
          <Zap size={25} />
        </span>
        <div>
          <h3>{t("From intention to a dependable routine.")}</h3>
          <p>
            {t(
              "Schedule a briefing or an assistant task. Your independent worker keeps track of runs, retries and approvals.",
            )}{" "}
          </p>
        </div>
        <span className="outline-tag">
          <ShieldCheck size={13} /> {t("Permission aware")}{" "}
        </span>
      </div>
      <Failure error={query.error} retry={() => void query.refetch()} />
      <ErrorText text={action.error} />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <p className="field-note">{t("Automations could not be loaded.")}</p>
      ) : !query.data?.length ? (
        <section className="panel">
          <Empty
            icon={<Zap size={29} strokeWidth={1.3} />}
            title={t("Let a routine carry a little weight.")}
            text={t(
              "Create your first automation. A morning briefing is a good place to start.",
            )}
            action={
              <Button variant="secondary" onClick={() => setEdit("new")}>
                <Plus size={15} /> {t("Create a routine")}{" "}
              </Button>
            }
          />
        </section>
      ) : (
        <div className="automation-list">
          {query.data.map((item) => (
            <section className="panel automation-card" key={item.id}>
              <span className="automation-icon">
                <Zap size={22} />
              </span>
              <div className="automation-copy">
                <div>
                  <h3>{item.title}</h3>
                  <Badge status={item.status} />
                </div>
                <p>{item.prompt}</p>
                <div className="automation-meta">
                  {item.extra?.kind === "briefing" && (
                    <span>
                      <FileText size={13} /> {t("Daily briefing")}{" "}
                    </span>
                  )}
                  <span>
                    <Clock3 size={13} />
                    <code>{item.cron || t("One time")}</code> · {item.timezone}
                  </span>
                  <span>
                    {t("Next:")}{" "}
                    {item.next_run_at
                      ? `${dateLabel(item.next_run_at)} ${timeLabel(item.next_run_at)}`
                      : t("Not scheduled")}
                  </span>
                </div>
                <AutomationHistory item={item} />
              </div>
              <div className="automation-actions">
                <button
                  className="icon-button"
                  disabled={
                    action.pending ||
                    ["cancelled", "completed"].includes(item.status || "")
                  }
                  aria-label={
                    item.status === "active"
                      ? t("Pause automation")
                      : t("Resume automation")
                  }
                  onClick={() => {
                    void status(
                      item,
                      item.status === "active" ? "paused" : "active",
                    );
                  }}
                >
                  {item.status === "active" ? (
                    <Pause size={17} />
                  ) : (
                    <Play size={17} />
                  )}
                </button>
                <button
                  className="icon-button"
                  disabled={action.pending}
                  aria-label={t("Retry automation")}
                  onClick={() => {
                    void action.run(() =>
                      api(`/automations/${item.id}/retry`, {
                        method: "POST",
                        body: JSON.stringify({ version: item.version }),
                      }),
                    );
                  }}
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t("Edit automation")}
                  onClick={() => setEdit(item)}
                >
                  <Edit3 size={16} />
                </button>
                <button
                  className="icon-button delete"
                  aria-label={t("Cancel automation")}
                  disabled={action.pending || item.status === "cancelled"}
                  onClick={() => {
                    if (
                      confirm(
                        t(
                          "Cancel this automation? It will no longer be scheduled.",
                        ),
                      )
                    )
                      void status(item, "cancelled");
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {edit && (
        <ResourceEditor
          kind="automations"
          item={edit === "new" ? undefined : edit}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
function AutomationHistory({ item }: { item: RecordItem }) {
  const { t, dateLabel, timeLabel } = useI18n();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["automation-runs", item.id],
    enabled: open,
    queryFn: ({ signal }) =>
      apiAllPages<RecordItem & { attempts: number; scheduled_at: string }>(
        `/automations/${encodeURIComponent(item.id)}/runs`,
        signal,
      ),
  });
  return (
    <details
      className="briefing-history-item"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <History size={13} /> {t("View execution history")}
      </summary>
      {open && (
        <>
          <Failure error={query.error} retry={() => void query.refetch()} />
          {query.isPending ? (
            <Loading />
          ) : query.error ? (
            <p className="field-note">
              {t("Execution history could not be loaded.")}
            </p>
          ) : !query.data?.length ? (
            <p className="field-note">{t("No executions yet.")}</p>
          ) : (
            query.data.map((run) => (
              <article className="activity-row" key={run.id}>
                <History size={16} />
                <div>
                  <h3>
                    {dateLabel(run.scheduled_at)} ·{" "}
                    {timeLabel(run.scheduled_at)}
                  </h3>
                  <p>{t("Attempts: {count}", { count: run.attempts })}</p>
                  {run.error && <p>{run.error}</p>}
                  <details>
                    <summary>{t("Execution details")}</summary>
                    <pre>
                      {JSON.stringify(
                        { id: run.id, result: run.result },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
                <div>
                  <Badge status={run.status} />
                </div>
              </article>
            ))
          )}
        </>
      )}
    </details>
  );
}
export function IntegrationsPage() {
  const { t } = useI18n();
  const query = useRecords("integrations");
  const [edit, setEdit] = useState(false);
  const [tools, setTools] = useState<{
    item: RecordItem;
    tools: Record<string, unknown>[];
  }>();
  const [selectedTool, setSelectedTool] = useState("");
  const [argumentsText, setArgumentsText] = useState("{}");
  const [toolResult, setToolResult] = useState<unknown>();
  const action = useAction();
  async function loadTools(item: RecordItem) {
    await action.run(async () => {
      const result = await api<
        Record<string, unknown>[] | { tools: Record<string, unknown>[] }
      >(`/integrations/${item.id}/tools`);
      setTools({ item, tools: Array.isArray(result) ? result : result.tools });
      setToolResult(undefined);
    });
  }
  return (
    <>
      <PageHeader
        eyebrow={t("CONNECTED, ON YOUR TERMS")}
        title={t("Bring your world together.")}
        subtitle={t("Useful tools. Clear permissions. You stay in charge.")}
      >
        <Button onClick={() => setEdit(true)}>
          <Plus size={16} /> {t("Add MCP server")}{" "}
        </Button>
      </PageHeader>
      <div className="integration-grid">
        <section className="panel integration-feature">
          <div className="integration-brand">
            <Network size={25} />
          </div>
          <span className="outline-tag">{t("MCP")}</span>
          <h2>{t("A workspace that can do more.")}</h2>
          <p>
            {t(
              "Connect trusted tool servers using the Model Context Protocol. Review the available tools and grant only the permissions you need.",
            )}{" "}
          </p>
          <div className="integration-caution">
            <LockKeyhole size={16} />
            <span>
              {t(
                "New servers start untrusted. Connecting doesn’t grant permission to execute.",
              )}{" "}
            </span>
          </div>
          <Button variant="ghost" onClick={() => setEdit(true)}>
            {t("Add a tool server")} <Plus size={14} />
          </Button>
        </section>
      </div>
      <div className="section-title">
        <h2>{t("Your connections")}</h2>
        <span>
          {t("{count} connected configurations", {
            count: query.data?.length || 0,
          })}
        </span>
      </div>
      <Failure error={query.error} />
      <ErrorText text={action.error} />
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : !query.data?.length ? (
          <Empty
            icon={<Network size={27} />}
            title={t("An open door, when you're ready.")}
            text={t(
              "No services are connected yet. Your workspace works locally while you choose what to connect.",
            )}
          />
        ) : (
          query.data.map((item) => (
            <div className="connection-row" key={item.id}>
              <span className="connection-icon">
                <Network size={20} />
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.url || item.kind}</p>
                <small>
                  {t("Permissions:")}{" "}
                  {item.permissions?.join(", ") || t("None granted")}
                </small>
              </div>
              <Badge
                status={item.trusted ? "trusted" : item.status || "untrusted"}
              />
              {item.kind === "mcp" && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={action.pending}
                    onClick={() => {
                      void loadTools(item);
                    }}
                  >
                    {t("Review tools")}{" "}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            item.trusted
                              ? "Revoke trust for this server? Review its origin before authorizing."
                              : "Trust this server? Review its origin before authorizing.",
                          ),
                        )
                      )
                        void action.run(() =>
                          api(`/integrations/${item.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              trusted: !item.trusted,
                              version: item.version,
                            }),
                          }),
                        );
                    }}
                  >
                    {item.trusted ? t("Revoke trust") : t("Trust server")}
                  </Button>
                </>
              )}
              <button
                className="icon-button delete"
                aria-label={t("Remove connection")}
                onClick={() => {
                  if (confirm(t("Remove this connection?")))
                    void action.run(() => remove("integrations", item, t));
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </section>
      {edit && (
        <ResourceEditor kind="integrations" onClose={() => setEdit(false)} />
      )}
      {tools && (
        <div className="modal-overlay">
          <section
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tool-heading"
          >
            <div className="modal-head">
              <h2 id="tool-heading">
                {t("Tools ·")} {tools.item.title}
              </h2>
              <button
                className="icon-button"
                aria-label={t("Close tools")}
                onClick={() => setTools(undefined)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              {t(
                "Read the server’s tool descriptions before granting permission. Descriptions come from the server and are untrusted content.",
              )}{" "}
            </p>
            <div className="tool-review-list">
              {tools.tools.map((tool) => (
                <div key={String(tool.name)}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={
                        tools.item.permissions?.includes(String(tool.name)) ||
                        false
                      }
                      onChange={(e) => {
                        const permissions = e.target.checked
                          ? [
                              ...(tools.item.permissions || []),
                              String(tool.name),
                            ]
                          : (tools.item.permissions || []).filter(
                              (p) => p !== String(tool.name),
                            );
                        void action.run(async () => {
                          const updated = await api<RecordItem>(
                            `/integrations/${tools.item.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                permissions,
                                version: tools.item.version,
                              }),
                            },
                          );
                          setTools({ ...tools, item: updated });
                        });
                      }}
                    />
                    <strong>{String(tool.name)}</strong>
                  </label>
                  <p>
                    {String(tool.description || t("No description supplied"))}
                  </p>
                  <details>
                    <summary>{t("Input schema")}</summary>
                    <pre>
                      {JSON.stringify(
                        tool.inputSchema || tool.input_schema,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
            <label>
              {t("Call a granted tool")}{" "}
              <select
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value)}
              >
                <option value="">{t("Select tool…")}</option>
                {tools.tools.map((t) => (
                  <option key={String(t.name)} value={String(t.name)}>
                    {String(t.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Arguments (JSON)")}{" "}
              <textarea
                rows={4}
                value={argumentsText}
                onChange={(e) => setArgumentsText(e.target.value)}
              />
            </label>
            <ErrorText text={action.error} />
            <Button
              disabled={!selectedTool || action.pending}
              onClick={() => {
                void action.run(async () => {
                  const args: unknown = JSON.parse(argumentsText);
                  if (!args || typeof args !== "object" || Array.isArray(args))
                    throw new Error("Arguments must be a JSON object.");
                  const result = await api(
                    `/integrations/${tools.item.id}/call`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        tool: selectedTool,
                        arguments: args,
                      }),
                    },
                  );
                  setToolResult(result);
                });
              }}
            >
              {t("Request tool execution")} <ArrowUpRight size={15} />
            </Button>
            {toolResult !== undefined && (
              <pre className="tool-result">
                {JSON.stringify(toolResult, null, 2)}
              </pre>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function MemoryCleanupProgress({
  cleanup,
}: {
  cleanup?: RecordItem["cleanup"];
}) {
  const { t } = useI18n();
  const stageLabels: Record<string, string> = {
    pending: "Pending cleanup",
    complete: "Complete",
    not_required: "Not required",
    authorization_required: "Awaiting authorization",
    unverified: "Not verified",
    unknown: "Status unknown",
  };
  const stages = [
    {
      label: "Local memory contents",
      status:
        cleanup?.canonical_erased === true
          ? "complete"
          : cleanup?.canonical_erased === false
            ? "pending"
            : "unknown",
    },
    { label: "Memory Store", status: cleanup?.store },
    { label: "Conversation checkpoints", status: cleanup?.checkpoints },
    { label: "External memory provider", status: cleanup?.provider },
  ];
  return (
    <div role="status">
      <dl>
        {stages.map((stage) => (
          <div key={stage.label}>
            <dt>{t(stage.label)}</dt>
            <dd>
              {t(stageLabels[stage.status || "unknown"] || "Status unknown")}
            </dd>
          </div>
        ))}
      </dl>
      {cleanup?.provider === "authorization_required" && (
        <p>
          {t(
            "Hy-Memory authorization is required. External memory cleanup has not been verified.",
          )}
        </p>
      )}
      {cleanup?.last_error_type && (
        <p>
          {t("Last cleanup error: {error}", { error: cleanup.last_error_type })}
        </p>
      )}
    </div>
  );
}

export function ActivityPage() {
  const { t, dateLabel, timeLabel } = useI18n();
  const query = useRecords("activity");
  const approvals = useRecords("approvals");
  const decisions = {
    ...query,
    data: query.data?.filter((item) => item.action === "routing.decision"),
  };
  const [tab, setTab] = useState("all");
  const action = useAction();
  const pending =
    approvals.data?.filter((item) => item.status === "pending") || [];
  const resumable =
    approvals.data?.filter(
      (item) => item.tool === "memory.delete" && item.can_resume === true,
    ) || [];
  const selectedQuery =
    tab === "approvals" ? approvals : tab === "decisions" ? decisions : query;
  return (
    <>
      <PageHeader
        eyebrow={t("TRANSPARENCY, BUILT IN")}
        title={t("Nothing behind the scenes.")}
        subtitle={t(
          "Review requests, follow executions, and see what your assistant did.",
        )}
      >
        <Button
          variant="secondary"
          onClick={() => {
            void query.refetch();
            void approvals.refetch();
            void decisions.refetch();
          }}
        >
          <RefreshCw size={15} /> {t("Refresh")}{" "}
        </Button>
      </PageHeader>
      <ErrorText text={action.error} />
      <Failure error={approvals.error} retry={() => void approvals.refetch()} />
      {!approvals.error && !!resumable.length && (
        <section className="approvals-section">
          <div className="section-title">
            <h2>
              <ShieldCheck size={18} /> {t("Memory cleanup needs attention")}
            </h2>
          </div>
          {resumable.map((item) => (
            <article className="panel approval-card" key={item.id}>
              <div className="approval-card-head">
                <span className="approval-symbol">
                  <Brain size={22} />
                </span>
                <div>
                  <h3>{t("Memory deletion cleanup")}</h3>
                  <p>{t("Approval reference: {id}", { id: item.id })}</p>
                  <p>
                    {t(
                      "Continue the existing authorized deletion. Cleanup is not complete yet.",
                    )}
                  </p>
                </div>
                <span className="badge badge-deletion_pending">
                  {t("Cleanup needs attention")}
                </span>
              </div>
              <MemoryCleanupProgress cleanup={item.cleanup} />
              <div className="approval-buttons">
                <span>
                  <LockKeyhole size={13} />{" "}
                  {t(
                    "Uses your existing approval and original deletion scope.",
                  )}
                </span>
                <Button
                  size="sm"
                  disabled={action.pending}
                  onClick={() => {
                    void action.run(async () => {
                      try {
                        await api(
                          `/approvals/${encodeURIComponent(item.id)}/resume`,
                          {
                            method: "POST",
                            body: JSON.stringify({ version: item.version }),
                          },
                        );
                      } catch (error) {
                        // A failed cleanup can still advance its durable phase/version.
                        await Promise.all([
                          approvals.refetch(),
                          query.refetch(),
                        ]);
                        throw error;
                      }
                    });
                  }}
                >
                  {action.pending ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {t("Continue cleanup")}
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
      {!!pending.length && (
        <section className="approvals-section">
          <div className="section-title">
            <h2>
              <ShieldCheck size={18} /> {t("Waiting for your say")}{" "}
            </h2>
            <span>
              {pending.length} {t("pending")}
            </span>
          </div>
          {pending.map((item) => (
            <article className="panel approval-card" key={item.id}>
              <div className="approval-card-head">
                <span className="approval-symbol">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <h3>{item.title || t("Tool execution request")}</h3>
                  <p>
                    {t(
                      "Review the exact parameters before allowing this action.",
                    )}{" "}
                  </p>
                </div>
                <Badge status="pending" />
              </div>
              <pre>
                {JSON.stringify(
                  item.arguments || item.payload || item.extra,
                  null,
                  2,
                )}
              </pre>
              <div className="approval-buttons">
                <span>
                  <LockKeyhole size={13} />{" "}
                  {t("Your approval is bound to these arguments.")}{" "}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.pending}
                  onClick={() => {
                    void action.run(() =>
                      api(`/approvals/${item.id}/resolve`, {
                        method: "POST",
                        body: JSON.stringify({
                          decision: "rejected",
                          version: item.version,
                        }),
                      }),
                    );
                  }}
                >
                  {t("Reject")}{" "}
                </Button>
                <Button
                  size="sm"
                  disabled={action.pending}
                  onClick={() => {
                    void action.run(() =>
                      api(`/approvals/${item.id}/resolve`, {
                        method: "POST",
                        body: JSON.stringify({
                          decision: "approved",
                          version: item.version,
                        }),
                      }),
                    );
                  }}
                >
                  <Check size={14} /> {t("Approve action")}{" "}
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
      <div className="toolbar">
        <div className="tabs">
          {["all", "approvals", "decisions"].map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={tab === value ? "selected" : ""}
            >
              {value === "all"
                ? t("Execution history")
                : value === "approvals"
                  ? t("All approvals")
                  : t("Routing decisions")}
            </button>
          ))}
        </div>
        <span className="small-text">
          <ShieldCheck size={13} /> {t("An accountable assistant")}{" "}
        </span>
      </div>
      <Failure
        error={tab === "approvals" ? null : selectedQuery.error}
        retry={() => void selectedQuery.refetch()}
      />
      <section className="panel">
        {selectedQuery.isPending ? (
          <Loading />
        ) : selectedQuery.error ? (
          <p className="field-note">
            {t("Activity records could not be loaded.")}
          </p>
        ) : !selectedQuery.data?.length ? (
          <Empty
            icon={<History size={28} strokeWidth={1.3} />}
            title={t("A clear, quiet record.")}
            text={t(
              "Actions, permissions and execution outcomes will appear here as you use your workspace.",
            )}
          />
        ) : (
          <div className="activity-list">
            {selectedQuery.data?.map((item) => (
              <article key={item.id} className="activity-row">
                <span className="activity-icon">
                  {tab === "approvals" ? (
                    <ShieldCheck size={17} />
                  ) : tab === "decisions" ? (
                    <Compass size={17} />
                  ) : (
                    <Activity size={17} />
                  )}
                </span>
                <div>
                  <h3>
                    {item.title ||
                      item.action ||
                      item.action_type ||
                      item.kind ||
                      t("Execution")}
                  </h3>
                  <p>{item.content || item.summary || item.error}</p>
                  <details>
                    <summary>{t("View details")}</summary>
                    <pre>{JSON.stringify(item, null, 2)}</pre>
                  </details>
                </div>
                <div>
                  <Badge status={item.status} />
                  <time>
                    {dateLabel(item.created_at)} · {timeLabel(item.created_at)}
                  </time>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function SettingsPage({ user }: { user: User }) {
  const { t } = useI18n();
  const query = useAIConfiguration();
  return (
    <>
      <PageHeader
        eyebrow={t("YOUR WORKSPACE, YOUR WAY")}
        title={t("Make it feel like you.")}
        subtitle={t("Your model, your privacy, your preferences.")}
      />
      <AISetupNotice full />
      {query.data ? (
        <SettingsEditor
          key={user.id}
          user={user}
          initialSettings={query.data}
        />
      ) : query.isPending ? (
        <Loading />
      ) : null}
    </>
  );
}

function SettingsEditor({
  user,
  initialSettings,
}: {
  user: User;
  initialSettings: Settings;
}) {
  const { t } = useI18n();
  const query = useAIConfiguration();
  const action = useAction();
  // A background refresh may discover a newer version but must not silently
  // rebase a draft; every write uses the version the user actually reviewed.
  const [snapshot, setSnapshot] = useState(initialSettings);
  const [formRevision, setFormRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const [embeddingTesting, setEmbeddingTesting] = useState(false);
  const [chatTesting, setChatTesting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const remoteChanged = !!query.data && query.data.version !== snapshot.version;
  const blocked = action.pending || reloading || remoteChanged || !!query.error;

  async function reloadSettings() {
    if (
      !confirm(t("Reload the latest settings and discard this unsaved draft?"))
    )
      return;
    setReloading(true);
    try {
      const result = await query.refetch();
      if (!result.error && result.data) {
        setSnapshot(result.data);
        setFormRevision((revision) => revision + 1);
        setSaved(false);
        action.clear();
      }
    } finally {
      setReloading(false);
    }
  }
  async function persistSettings(
    changes: Record<string, unknown>,
    resetForm = false,
  ) {
    if (blocked || embeddingTesting || chatTesting) return false;
    let updated: Settings | undefined;
    let conflicted = false;
    const ok = await action.run(async () => {
      try {
        updated = await api<Settings>("/settings", {
          method: "PATCH",
          body: JSON.stringify({ ...changes, version: snapshot.version }),
        });
      } catch (error) {
        conflicted = error instanceof ApiError && error.status === 409;
        throw error;
      }
    });
    // A conflict can precede a focus refresh. Fetch the remote version without
    // rebasing or discarding the draft the user actually reviewed.
    if (conflicted) await query.refetch();
    if (ok && updated) {
      setSnapshot(updated);
      if (resetForm) setFormRevision((revision) => revision + 1);
    }
    return ok;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || embeddingTesting || chatTesting) return;
    const data = new FormData(event.currentTarget);
    setSaved(false);
    const payload: Record<string, unknown> = {
      name: data.get("name"),
      model: data.get("model"),
      decision_provider: data.get("decision_provider"),
      timezone: data.get("timezone"),
      memory_enabled: data.get("memory_enabled") === "on",
      embedding_model: data.get("embedding_model"),
      embedding_dimensions: Number(data.get("embedding_dimensions") || 1024),
    };
    for (const field of ["base_url", "embedding_base_url"] as const) {
      const value = String(data.get(field) || "").trim();
      if (value !== String(snapshot[field] || "").trim())
        payload[field] = value;
    }
    if (data.get("api_key")) payload.api_key = data.get("api_key");
    if (data.get("embedding_api_key"))
      payload.embedding_api_key = data.get("embedding_api_key");
    for (const field of ["fast_model", "reasoning_model"])
      payload[field] = String(data.get(field) || "").trim();
    if (await persistSettings(payload, true)) setSaved(true);
  }
  return (
    <>
      <ErrorText text={action.error} />
      {remoteChanged && (
        <div className="error-banner" role="alert">
          <span>
            {t(
              "Settings changed elsewhere. Your draft is kept; reload the latest settings before saving or testing.",
            )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={
              action.pending || reloading || embeddingTesting || chatTesting
            }
            onClick={() => void reloadSettings()}
          >
            <RefreshCw size={14} /> {t("Reload latest settings")}
          </Button>
        </div>
      )}
      {saved && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={17} />{" "}
          {t(
            "Configuration saved. Saving does not verify connectivity; test the chat and embedding connections separately.",
          )}{" "}
        </div>
      )}
      <div className="settings-layout">
        <form
          key={formRevision}
          className="settings-form"
          onChange={() => setSaved(false)}
          onSubmit={(e) => {
            void submit(e);
          }}
        >
          <fieldset
            className="embedding-fields"
            disabled={action.pending || reloading}
          >
            <ChatSettings
              settings={snapshot}
              pending={blocked || embeddingTesting}
              onChange={() => setSaved(false)}
              onTestPendingChange={setChatTesting}
              onRemoveKey={async () => {
                setSaved(false);
                return persistSettings({ api_key: "" });
              }}
            />
            <EmbeddingSettings
              settings={snapshot}
              pending={blocked || chatTesting}
              onTestPendingChange={setEmbeddingTesting}
              onChange={() => setSaved(false)}
              onRemoveKey={async () => {
                setSaved(false);
                return persistSettings({ embedding_api_key: "" });
              }}
            />
            <section className="panel settings-section">
              <div className="settings-section-heading">
                <span className="small-icon">
                  <Brain size={21} />
                </span>
                <div>
                  <h2>{t("Memory & preferences")}</h2>
                  <p>
                    {t(
                      "Choose how your workspace remembers and organizes your day.",
                    )}{" "}
                  </p>
                </div>
              </div>
              <LanguageSelector />
              <div className="toggle-field">
                <div>
                  <strong>{t("Suggest long-term memories")}</strong>
                  <p>
                    {t(
                      "Your assistant can propose useful context. You confirm what gets saved.",
                    )}{" "}
                  </p>
                </div>
                <input
                  type="checkbox"
                  name="memory_enabled"
                  className="switch"
                  defaultChecked={snapshot.memory_enabled ?? true}
                  aria-label={t("Suggest long-term memories")}
                />
              </div>
              <div className="form-grid">
                <label>
                  {t("Display name")}{" "}
                  <input
                    name="name"
                    defaultValue={String(snapshot.name || user.name || "")}
                  />
                </label>
                <label>
                  {t("Time zone")}{" "}
                  <input
                    name="timezone"
                    defaultValue={String(
                      snapshot.timezone ||
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                    )}
                    placeholder="Asia/Shanghai"
                    required
                  />
                </label>
              </div>
            </section>
            <div className="settings-save">
              <span>
                {saved
                  ? t("Changes saved")
                  : t("Changes apply to your account only.")}
              </span>
              <Button
                type="submit"
                disabled={blocked || embeddingTesting || chatTesting}
              >
                {action.pending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Check size={15} />
                )}{" "}
                {t("Save changes")}{" "}
              </Button>
            </div>
          </fieldset>
        </form>
        <aside>
          <section className="panel privacy-card">
            <ShieldCheck size={27} strokeWidth={1.3} />
            <h2>
              {t("Private by design.")} <br />
              {t("Controlled by you.")}{" "}
            </h2>
            <p>
              {t(
                "Your assistant uses your context to help you. You decide what it knows and what it can do.",
              )}{" "}
            </p>
            <ul>
              <li>
                <Check size={13} /> {t("User-isolated workspace data")}{" "}
              </li>
              <li>
                <Check size={13} /> {t("Keys held on the server")}{" "}
              </li>
              <li>
                <Check size={13} /> {t("Explicit action approvals")}{" "}
              </li>
              <li>
                <Check size={13} /> {t("Export and delete your memories")}{" "}
              </li>
            </ul>
          </section>
          <section className="panel data-card">
            <h3>{t("Your data travels with you.")}</h3>
            <p>
              {t(
                "Download your workspace as a JSON archive. API keys and authorization tokens are excluded.",
              )}{" "}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void action.run(downloadExport);
              }}
            >
              <ArrowDownToLine size={14} /> {t("Export workspace")}{" "}
            </Button>
            <div className="data-divider" />
            <h3>{t("Start a fresh memory.")}</h3>
            <p>
              {t(
                "Review and remove individual memories in your memory center. Deletions require your approval.",
              )}{" "}
            </p>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/memory">
                <Brain size={14} /> {t("Manage memories")}{" "}
              </Link>
            </Button>
            <div className="data-divider" />
            <h3>{t("Close your account.")}</h3>
            <p>
              {t(
                "Request deletion of your workspace, memories, conversations and saved credentials. Review and approve the request in Activity before deletion takes place.",
              )}{" "}
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={action.pending}
              onClick={() => {
                if (
                  prompt(
                    t(
                      "Type DELETE to request permanent account deletion. You will still need to approve the exact request in Activity.",
                    ),
                  ) === "DELETE"
                )
                  void action.run(async () => {
                    await api("/account/delete", {
                      method: "POST",
                      body: JSON.stringify({ confirmation: "DELETE" }),
                    });
                    alert(
                      t(
                        "Your account deletion request is awaiting approval in Activity & approvals.",
                      ),
                    );
                  });
              }}
            >
              <Trash2 size={13} /> {t("Request account deletion")}{" "}
            </Button>
          </section>
          <div className="account-note">
            <span className="user-avatar">{user.email[0].toUpperCase()}</span>
            <div>
              <strong>{user.email}</strong>
              <small>{t("Signed in to your personal account")}</small>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  created_at?: string;
}
interface StreamEvent {
  type: string;
  content?: string;
  message?: string;
  session_id?: string;
  tool?: string;
  name?: string;
  arguments?: unknown;
  result?: unknown;
  status?: string;
}
export function ChatPage() {
  const { t, dateLabel } = useI18n();
  const client = useQueryClient();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<RecordItem[]>("/chat/sessions"),
  });
  const settings = useAIConfiguration();
  const [session, setSession] = useState<string | undefined>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("session") || undefined
      : undefined,
  );
  const history = useQuery({
    queryKey: ["messages", session],
    queryFn: () => api<ChatMessage[]>(`/chat/sessions/${session}/messages`),
    enabled: !!session,
  });
  const [messages, setMessages] = useState<ChatMessage[]>();
  const visibleMessages = messages ?? history.data ?? [];
  const [input, setInput] = useState("");
  const [model, setModel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, history.data]);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || pending) return;
    if (!settings.data?.chat_configured || settings.error) {
      setError(
        "Complete and save the chat Model ID, Base URL and API key in Settings first. Your input has been kept.",
      );
      return;
    }
    const text = input.trim();
    setInput("");
    setError(undefined);
    setEvents([]);
    setPending(true);
    const requestController = new AbortController();
    controller.current = requestController;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminalReceived = false;
    let streamFailed = false;
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...(prev ?? history.data ?? []),
      { id: crypto.randomUUID(), role: "user", content: text },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: session,
          model: model || settings.data?.model || undefined,
        }),
        signal: requestController.signal,
      });
      // The server persists the conversation before model execution. Pin its
      // identity before reading tokens so failures/cancellation keep context.
      const responseSession = response.headers.get("X-Session-ID");
      if (responseSession) setSession(responseSession);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : "The model provider could not complete this request.",
        );
      }
      if (!response.body) throw new Error("This response has no stream.");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      function consume(frame: string) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") return;
        const update = JSON.parse(data) as StreamEvent;
        if (update.session_id) setSession(update.session_id);
        if (update.type === "token")
          setMessages((prev) =>
            (prev || []).map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + (update.content || "") }
                : m,
            ),
          );
        else if (update.type === "done") {
          terminalReceived = true;
        } else if (update.type === "error")
          throw new Error(
            update.message ||
              update.content ||
              "The assistant encountered an error.",
          );
        else if (update.type !== "session")
          setEvents((prev) => [...prev.slice(-19), update]);
      }
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replaceAll("\r\n", "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          consume(frame);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      if (!terminalReceived)
        throw new Error(
          "The connection ended before completion. Your conversation is kept; check its history before retrying.",
        );
    } catch (err) {
      streamFailed = true;
      if (err instanceof Error && err.name === "AbortError")
        setError("Generation stopped. Any completed content is shown above.");
      else
        setError(
          err instanceof Error ? err.message : "Couldn't reach your assistant.",
        );
    } finally {
      if (!terminalReceived || streamFailed) requestController.abort();
      if (reader) {
        try {
          if (!terminalReceived || streamFailed) await reader.cancel();
        } catch {
          // An already-aborted body can reject cancellation. Preserve the
          // original visible failure instead of replacing it with cleanup noise.
        } finally {
          reader.releaseLock();
        }
      }
      if (controller.current === requestController) controller.current = null;
      setPending(false);
      await client.invalidateQueries({ queryKey: ["sessions"] });
    }
  }
  function newChat() {
    controller.current?.abort();
    setSession(undefined);
    setMessages([]);
    setEvents([]);
    setError(undefined);
  }
  return (
    <>
      <PageHeader
        eyebrow={t("A THOUGHTFUL COLLABORATOR")}
        title={t("A little perspective helps.")}
        subtitle={t("Plan something, ask a question, or think out loud.")}
      >
        <Button variant="secondary" onClick={newChat} disabled={pending}>
          <Plus size={15} /> {t("New conversation")}{" "}
        </Button>
      </PageHeader>
      <div className="chat-layout">
        <section className="panel chat-panel">
          <div className="chat-model-bar">
            <span className="assistant-avatar">
              <Sparkles size={17} />
            </span>
            <div>
              <strong>PersonalOS</strong>
              <span>{t("Your personal assistant")}</span>
            </div>
            <label className="model-picker">
              <span className="sr-only">{t("Model")}</span>
              <input
                aria-label={t("Model ID")}
                placeholder={String(
                  settings.data?.model || t("Model not configured"),
                )}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={pending}
              />
              <span
                className={
                  settings.data?.chat_configured
                    ? "tiny-dot"
                    : "tiny-dot muted-dot"
                }
              />
            </label>
          </div>
          <div className="chat-messages">
            {history.isPending && session ? (
              <Loading />
            ) : !visibleMessages.length ? (
              <div className="chat-welcome">
                <div className="welcome-symbol">
                  <Sparkles size={34} strokeWidth={1.2} />
                </div>
                <span className="eyebrow">{t("A LITTLE MORE HEADSPACE")}</span>
                <h2>{t("What’s on your mind?")}</h2>
                <p>
                  {t("There’s no perfect way to start.")} <br />
                  {t(
                    "Bring a thought, a task, or a little everyday chaos.",
                  )}{" "}
                </p>
                <div className="chat-suggestions">
                  {[
                    { icon: CalendarDays, text: t("Help me plan my day") },
                    { icon: Brain, text: t("What do you remember about me?") },
                    {
                      icon: CheckCircle2,
                      text: t("Help me break down a task"),
                    },
                    { icon: Leaf, text: t("What should I focus on next?") },
                  ].map(({ icon: Icon, text }) => (
                    <button onClick={() => setInput(text)} key={text}>
                      <Icon size={17} />
                      <span>{text}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                {settings.data && !settings.data.chat_configured && (
                  <div className="chat-setup-note">
                    <LockKeyhole size={15} />{" "}
                    {t(
                      "First fill in your chat Model ID, Base URL and API key:",
                    )}{" "}
                    <Link href="/settings?setup=1#chat-configuration">
                      {t("Configure chat model")}{" "}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              visibleMessages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message message-${message.role}`}
                >
                  <span className="message-avatar">
                    {message.role === "assistant" ? (
                      <Sparkles size={17} />
                    ) : (
                      t("You")
                    )}
                  </span>
                  <div>
                    <strong>
                      {message.role === "assistant" ? "PersonalOS" : t("You")}
                    </strong>
                    <div className="message-content">
                      {message.content ? (
                        message.role === "assistant" ? (
                          <MessageMarkdown content={message.content} />
                        ) : (
                          message.content
                        )
                      ) : pending ? (
                        <span className="typing-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        <span className="small-text">
                          {t("No answer was generated.")}{" "}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
            <div ref={bottom} />
          </div>
          {events.length > 0 && (
            <details className="tool-timeline" open={pending}>
              <summary>
                <Zap size={13} />{" "}
                {t(
                  events.length === 1
                    ? "{count} execution update"
                    : "{count} execution updates",
                  { count: events.length },
                )}
              </summary>
              {events.map((item, i) => (
                <div key={i}>
                  <span className="tiny-dot" />
                  <strong>
                    {item.tool || item.name || t(item.status || item.type)}
                  </strong>
                  {item.content && <span>{item.content}</span>}
                  <pre>
                    {JSON.stringify(
                      item.arguments || item.result || item,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ))}
            </details>
          )}
          <Failure error={history.error} />
          <ErrorText text={error} />
          {error && !settings.data?.chat_configured && (
            <div className="chat-config-action">
              <Link href="/settings?setup=1#chat-configuration">
                {t("Configure the chat model in Settings")}{" "}
                <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
          <form
            className="chat-composer"
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("A thought, a plan, a question…")}
              aria-label={t("Message your assistant")}
              rows={2}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void submit(e);
                }
              }}
            />
            <div>
              <span>
                <ShieldCheck size={12} />{" "}
                {t("You approve sensitive actions.")}{" "}
              </span>
              {pending ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={() => controller.current?.abort()}
                  aria-label={t("Stop generation")}
                >
                  <X size={18} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || settings.isPending}
                  aria-label={t("Send message")}
                >
                  <ArrowUpRight size={19} />
                </Button>
              )}
            </div>
          </form>
          <p className="chat-disclaimer">
            {t(
              "AI can make mistakes. Keep a human eye on important details.",
            )}{" "}
          </p>
        </section>
        <aside className="chat-aside">
          <div className="panel-heading">
            <h3>{t("Conversations")}</h3>
            <button
              className="icon-button"
              aria-label={t("New conversation")}
              onClick={newChat}
              disabled={pending}
            >
              <Plus size={16} />
            </button>
          </div>
          <Failure error={sessions.error} />
          {sessions.isPending ? (
            <Loading />
          ) : !sessions.data?.length ? (
            <div className="quiet-empty">
              <MessageSquare size={23} />
              <strong>{t("A fresh conversation.")}</strong>
              <p>{t("Your saved conversations will appear here.")}</p>
            </div>
          ) : (
            sessions.data.map((item) => (
              <button
                className={`session-item ${session === item.id ? "selected" : ""}`}
                disabled={pending}
                key={item.id}
                onClick={() => {
                  setMessages(undefined);
                  setSession(item.id);
                  setEvents([]);
                  setError(undefined);
                }}
              >
                <MessageSquare size={15} />
                <span>
                  {item.title || t("Conversation")}
                  <small>{dateLabel(item.updated_at || item.created_at)}</small>
                </span>
              </button>
            ))
          )}
          <div className="chat-context-note">
            <Brain size={20} />
            <h3>{t("Context that belongs to you.")}</h3>
            <p>
              {t(
                "Your assistant recalls confirmed memories to make its answers more relevant.",
              )}{" "}
            </p>
            <Link href="/memory" className="text-link">
              {t("Review your memories")} <ArrowRight size={13} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}

function ResourceEditor({
  kind,
  item,
  initial,
  onClose,
}: {
  kind: string;
  item?: RecordItem;
  initial?: { start_at: string; end_at: string; calendar_id?: string };
  onClose: () => void;
}) {
  const { t, dateLabel } = useI18n();
  const action = useAction();
  const calendars = useCalendars(kind === "calendar");
  const calendarList = calendars.data?.items || [];
  const [scopeChoice, setScopeChoice] = useState<Record<string, unknown>>();
  const [category, setCategory] = useState(item?.category || "fact");
  const [memoryTopic, setMemoryTopic] = useState(
    typeof item?.extra?.fact_key === "string" ? item.extra.fact_key : "",
  );
  const [replacements, setReplacements] = useState<string[]>(
    Array.isArray(item?.extra?.supersedes)
      ? item.extra.supersedes.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  );
  const debouncedMemoryTopic = useDebouncedSearch(memoryTopic);
  const memoryCandidates = useQuery({
    queryKey: ["memory-conflict-candidates", debouncedMemoryTopic],
    staleTime: 0,
    enabled: kind === "memory" && !!debouncedMemoryTopic,
    queryFn: ({ signal }) =>
      apiAllPages<RecordItem>(
        `/memories?topic=${encodeURIComponent(debouncedMemoryTopic)}`,
        signal,
      ),
  });
  const conflictingMemories = (memoryCandidates.data || []).filter(
    (candidate) =>
      candidate.id !== item?.id &&
      candidate.status === "confirmed" &&
      candidate.extra?.fact_key === memoryTopic.trim(),
  );
  const [automationKind, setAutomationKind] = useState(
    item?.extra?.kind === "briefing" ? "briefing" : "agent",
  );
  const titles: Record<string, string> = {
    tasks: "task",
    memory: "memory",
    calendar: "event",
    automations: "automation",
    integrations: "MCP server",
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    const string = (key: string) => String(form.get(key) || "");
    if (kind === "tasks")
      Object.assign(body, {
        title: string("title"),
        content: string("content"),
        status: string("status"),
        priority: string("priority"),
        due_at: string("due_at")
          ? new Date(string("due_at")).toISOString()
          : null,
      });
    if (kind === "memory")
      Object.assign(body, {
        content: string("content"),
        category,
        // Changes need a separate explicit confirmation after the revised fact is saved.
        status: "pending",
        source: item?.source || "Added manually by user",
        extra: {
          ...(Array.isArray(item?.extra?.tags)
            ? { tags: item.extra.tags }
            : {}),
          ...(memoryTopic.trim()
            ? {
                fact_key: memoryTopic.trim(),
                supersedes: replacements.filter((id) =>
                  conflictingMemories.some((candidate) => candidate.id === id),
                ),
              }
            : {}),
        },
      });
    if (kind === "calendar") {
      const allDay = string("all_day") === "on";
      const start = new Date(string("start_at"));
      const end = new Date(string("end_at"));
      Object.assign(body, {
        title: string("title"),
        content: string("content"),
        start_at: allDay
          ? startOfDay(start).toISOString()
          : start.toISOString(),
        end_at: allDay
          ? addDays(startOfDay(end > start ? end : start), 1).toISOString()
          : end.toISOString(),
        calendar_id: string("calendar_id") || undefined,
        location: string("location"),
        all_day: allDay,
        timezone: browserTimezone(),
        rrule: string("repeat") || null,
        reminders: string("reminder") ? [Number(string("reminder"))] : [],
        provider: "local",
      });
    }
    if (kind === "automations")
      Object.assign(body, {
        title: string("title"),
        prompt: string("prompt"),
        extra: { ...item?.extra, kind: automationKind },
        cron: string("cron") || null,
        timezone: string("timezone"),
        status: string("status"),
        next_run_at: string("next_run_at")
          ? new Date(string("next_run_at")).toISOString()
          : undefined,
      });
    if (kind === "integrations")
      Object.assign(body, {
        title: string("title"),
        kind: "mcp",
        url: string("url"),
        trusted: false,
        permissions: [],
      });
    if (item) body.version = item.version;
    // A recurring event needs an explicit occurrence scope before it is written.
    if (kind === "calendar" && item?.recurring === true) {
      setScopeChoice(body);
      return;
    }
    await save(body);
  }
  async function save(body: Record<string, unknown>, scope?: EventScope) {
    const ok = await action.run(async () => {
      const query = new URLSearchParams();
      if (scope) {
        query.set("scope", scope);
        if (scope !== "all" && item?.occurrence_start)
          query.set("occurrence_start", item.occurrence_start);
      }
      const search = query.toString();
      const result = await api<{ approval_required?: boolean }>(
        `${resourcePaths[kind]}${item ? `/${item.id}${search ? `?${search}` : ""}` : ""}`,
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      if (result?.approval_required)
        alert(
          t(
            "This action has been sent for your approval. Review it in Activity & approvals.",
          ),
        );
    });
    if (ok) onClose();
  }
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">{t("A LITTLE MORE INTENTION")}</span>
            <h2 id="editor-title">
              {t(item ? "Edit {resource}" : "Add {resource}", {
                resource: t(titles[kind]),
              })}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label={t("Close editor")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          {kind !== "memory" && (
            <label>
              {kind === "integrations" ? t("Server name") : t("Title")}
              <input
                name="title"
                autoFocus
                defaultValue={item?.title || ""}
                placeholder={
                  kind === "tasks"
                    ? t("What would you like to move forward?")
                    : kind === "automations"
                      ? t("e.g. A thoughtful morning briefing")
                      : kind === "integrations"
                        ? t("A name you'll recognize")
                        : t("What’s happening?")
                }
                required
                maxLength={240}
              />
            </label>
          )}
          {["tasks", "calendar"].includes(kind) && (
            <label>
              {t("Notes")} <span className="label-meta">{t("optional")}</span>
              <textarea
                name="content"
                rows={3}
                defaultValue={item?.content || ""}
                placeholder={t("A little helpful context…")}
              />
            </label>
          )}
          {kind === "tasks" && (
            <>
              <div className="form-grid">
                <label>
                  {t("Priority")}{" "}
                  <select
                    name="priority"
                    defaultValue={item?.priority || "medium"}
                  >
                    <option value="low">
                      {t("Low · whenever there’s room")}
                    </option>
                    <option value="medium">{t("Medium · keep in view")}</option>
                    <option value="high">{t("High · make it a focus")}</option>
                  </select>
                </label>
                <label>
                  {t("Status")}{" "}
                  <select name="status" defaultValue={item?.status || "todo"}>
                    <option value="todo">{t("To do")}</option>
                    <option value="in_progress">{t("In progress")}</option>
                    <option value="done">{t("Done")}</option>
                    <option value="cancelled">{t("Cancelled")}</option>
                  </select>
                </label>
              </div>
              <label>
                {t("Due date")}{" "}
                <span className="label-meta">{t("optional")}</span>
                <input
                  name="due_at"
                  type="datetime-local"
                  defaultValue={inputDate(item?.due_at)}
                />
              </label>
            </>
          )}
          {kind === "memory" && (
            <>
              <label>
                {t("What’s worth remembering?")}{" "}
                <textarea
                  name="content"
                  autoFocus
                  rows={4}
                  defaultValue={item?.content || ""}
                  placeholder={t(
                    "e.g. I do my best focused work in the morning.",
                  )}
                  required
                  maxLength={10000}
                />
              </label>
              <label>
                {t("Category")}{" "}
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="fact">{t("Important fact")}</option>
                  <option value="preference">{t("Preference")}</option>
                  <option value="goal">{t("Long-term goal")}</option>
                  <option value="task_context">{t("Task context")}</option>
                </select>
              </label>
              <label>
                {t("Memory topic")}{" "}
                <span className="label-meta">{t("optional")}</span>
                <input
                  name="memory_topic"
                  value={memoryTopic}
                  onChange={(event) => {
                    setMemoryTopic(event.target.value);
                    setReplacements([]);
                  }}
                  placeholder={t("e.g. work-hours")}
                  maxLength={120}
                />
              </label>
              <div className="field-note">
                {t(
                  "Use the same topic when correcting an existing fact. Nothing is replaced automatically.",
                )}{" "}
              </div>
              {!!memoryTopic.trim() && (
                <fieldset className="memory-conflicts">
                  <legend>{t("Replace conflicting facts")}</legend>
                  <Failure
                    error={memoryCandidates.error}
                    retry={() => {
                      void memoryCandidates.refetch();
                    }}
                  />
                  {memoryCandidates.isPending ||
                  memoryTopic.trim() !== debouncedMemoryTopic ? (
                    <Loading />
                  ) : memoryCandidates.error ? (
                    <p>{t("Memory conflicts could not be loaded.")}</p>
                  ) : conflictingMemories.length ? (
                    <>
                      <p>
                        {t(
                          "Select every confirmed fact that this new version should replace. Unselected conflicts will prevent confirmation.",
                        )}{" "}
                      </p>
                      {conflictingMemories.map((candidate) => (
                        <label className="checkbox-label" key={candidate.id}>
                          <input
                            type="checkbox"
                            checked={replacements.includes(candidate.id)}
                            onChange={(event) =>
                              setReplacements((current) =>
                                event.target.checked
                                  ? [...current, candidate.id]
                                  : current.filter((id) => id !== candidate.id),
                              )
                            }
                          />
                          <span>
                            <strong>{candidate.content}</strong>
                            <small>
                              {t("Source:")}{" "}
                              {candidate.source === "Added manually by user"
                                ? t("Added manually by user")
                                : candidate.source || t("Added by you")}{" "}
                              · {dateLabel(candidate.created_at)}
                            </small>
                          </span>
                        </label>
                      ))}
                    </>
                  ) : (
                    <p>{t("No confirmed facts use this topic.")}</p>
                  )}
                  <small>{t("Showing confirmed facts for this topic.")}</small>
                </fieldset>
              )}
              <div className="consent-box memory-review-note">
                <ShieldCheck size={18} />
                <span>
                  <strong>{t("Save first. Confirm when you’re ready.")}</strong>
                  <small>
                    {t(
                      "New and edited memories are saved for review. Confirm the memory card afterward to use it as long-term context.",
                    )}{" "}
                  </small>
                </span>
              </div>
              {item?.source && (
                <div className="field-note">
                  <FileText size={13} /> {t("Source:")} {item.source}
                </div>
              )}
            </>
          )}
          {kind === "calendar" && (
            <>
              <div className="form-grid">
                <label>
                  {t("Starts")}{" "}
                  <input
                    name="start_at"
                    type="datetime-local"
                    required
                    defaultValue={inputDate(item?.start_at || initial?.start_at)}
                  />
                </label>
                <label>
                  {t("Ends")}{" "}
                  <input
                    name="end_at"
                    type="datetime-local"
                    required
                    defaultValue={inputDate(item?.end_at || initial?.end_at)}
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  name="all_day"
                  type="checkbox"
                  defaultChecked={item?.all_day === true}
                />
                <span>{t("All day")}</span>
              </label>
              {calendarList.length > 0 && (
                <label>
                  {t("Calendar")}{" "}
                  <select
                    name="calendar_id"
                    defaultValue={
                      item?.calendar_id ||
                      initial?.calendar_id ||
                      calendarList.find((calendar) => calendar.is_default)?.id ||
                      calendarList[0]?.id
                    }
                  >
                    {calendarList.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="form-grid">
                <label>
                  {t("Repeat")}{" "}
                  <select name="repeat" defaultValue={repeatValue(item?.rrule)}>
                    {repeatRules.map(([value, label]) => (
                      <option key={value || "none"} value={value}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Location")}{" "}
                  <span className="label-meta">{t("optional")}</span>
                  <input
                    name="location"
                    defaultValue={item?.location || ""}
                    maxLength={240}
                  />
                </label>
              </div>
              <label>
                {t("Reminder")}{" "}
                <select
                  name="reminder"
                  defaultValue={String(
                    Array.isArray(item?.reminders) && item.reminders.length
                      ? item.reminders[0]
                      : "",
                  )}
                >
                  {eventReminders.map(([value, label]) => (
                    <option key={value || "none"} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              {item?.recurring && (
                <div className="field-note">
                  <Clock3 size={14} />{" "}
                  {t(
                    "This event repeats. Saving asks which occurrences to change.",
                  )}{" "}
                </div>
              )}
            </>
          )}
          {kind === "automations" && (
            <>
              <label>
                {t("Routine type")}{" "}
                <select
                  name="automation_kind"
                  value={automationKind}
                  onChange={(event) => setAutomationKind(event.target.value)}
                >
                  <option value="agent">{t("AI assistant task")}</option>
                  <option value="briefing">{t("Daily briefing")}</option>
                </select>
              </label>
              {automationKind === "briefing" && (
                <div className="field-note">
                  <FileText size={13} />{" "}
                  {t(
                    "Generates and saves a briefing from your real tasks, calendar and confirmed memories.",
                  )}{" "}
                </div>
              )}
              <label>
                {automationKind === "briefing"
                  ? t("Routine note")
                  : t("What should your assistant do?")}
                <textarea
                  name="prompt"
                  rows={3}
                  required
                  defaultValue={item?.prompt || ""}
                  placeholder={t(
                    "e.g. Give me a concise briefing of today's tasks, events and priorities.",
                  )}
                />
              </label>
              <div className="form-grid">
                <label>
                  {t("Schedule (cron)")}{" "}
                  <input
                    name="cron"
                    defaultValue={item ? (item.cron ?? "") : "0 8 * * *"}
                    placeholder="0 8 * * *"
                  />
                </label>
                <label>
                  {t("Time zone")}{" "}
                  <input
                    name="timezone"
                    required
                    defaultValue={
                      item?.timezone ||
                      Intl.DateTimeFormat().resolvedOptions().timeZone
                    }
                  />
                </label>
              </div>
              <div className="field-note">
                <Clock3 size={13} />{" "}
                {t(
                  "“0 8 * * *” runs daily at 08:00. Leave blank for a one-time run.",
                )}{" "}
              </div>
              <div className="form-grid">
                <label>
                  {t("One-time / next execution")}{" "}
                  <input
                    name="next_run_at"
                    type="datetime-local"
                    defaultValue={inputDate(item?.next_run_at)}
                  />
                </label>
                <label>
                  {t("Status")}{" "}
                  <select name="status" defaultValue={item?.status || "active"}>
                    <option value="active">{t("Active")}</option>
                    <option value="paused">{t("Paused")}</option>
                    <option value="cancelled">{t("Cancelled")}</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {kind === "integrations" && (
            <>
              <label>
                {t("HTTPS server URL")}{" "}
                <input
                  name="url"
                  type="url"
                  required
                  placeholder="https://your-trusted-server.example/mcp"
                  pattern="https://.*"
                />
              </label>
              <div className="info-strip">
                <ShieldCheck size={20} />
                <p>
                  {t(
                    "New servers start untrusted with no permissions. You’ll review tools and explicitly authorize access after adding the server.",
                  )}{" "}
                </p>
              </div>
            </>
          )}
          {scopeChoice && (
            <fieldset>
              <legend>
                {t("This event repeats. Choose which events to update.")}
              </legend>
              <div className="heading-actions">
                {eventScopes.map(([scope, label]) => (
                  <Button
                    key={scope}
                    type="button"
                    variant={scope === "all" ? "ghost" : "secondary"}
                    disabled={action.pending}
                    onClick={() => {
                      void save(scopeChoice, scope);
                    }}
                  >
                    {t(label)}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}
          <ErrorText text={action.error} />
          <div className="modal-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}{" "}
            </Button>
            <Button type="submit" disabled={action.pending}>
              {action.pending ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              {item
                ? t("Save changes")
                : t("Add {resource}", { resource: t(titles[kind]) })}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
