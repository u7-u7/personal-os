"use client";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bot,
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
  dateLabel,
  inputDate,
  timeLabel,
  type RecordItem,
  type Settings,
  type User,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

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
    queryFn: () => api<RecordItem[]>(resourcePaths[kind] || `/${kind}`),
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
  return error ? (
    <div className="error-banner" role="alert">
      <span>{error.message}</span>
      {retry && (
        <button onClick={retry}>
          Try again <RefreshCw size={13} />
        </button>
      )}
    </div>
  ) : null;
}
function Loading() {
  return (
    <div className="skeleton-list" aria-label="Loading">
      <div />
      <div />
      <div />
    </div>
  );
}
function Badge({ status }: { status?: string }) {
  return (
    <span className={`badge badge-${status || "default"}`}>
      {status?.replaceAll("_", " ") || "unknown"}
    </span>
  );
}
function ErrorText({ text }: { text?: string }) {
  return text ? (
    <div className="error-banner" role="alert">
      {text}
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
  return (
    <div className="row-actions">
      <button className="icon-button" aria-label="Edit" onClick={onEdit}>
        <Edit3 size={15} />
      </button>
      <button
        className="icon-button delete"
        aria-label="Delete"
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
async function remove(kind: string, item: RecordItem) {
  const result = await api<{ approval_required?: boolean }>(
    `${resourcePaths[kind]}/${item.id}?version=${item.version}`,
    { method: "DELETE", body: JSON.stringify({ version: item.version }) },
  );
  if (result?.approval_required)
    alert(
      "Deletion is waiting for your approval. Review the request in Activity & approvals.",
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
  events: RecordItem[];
  memories: RecordItem[];
  automations: RecordItem[];
  approvals: RecordItem[];
  briefing: RecordItem | null;
}
export function DashboardPage({ user }: { user: User }) {
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
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  async function generate() {
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
          .toLocaleDateString("en", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          .toUpperCase()}
        title={`${greeting}, ${user.name || user.email.split("@")[0]}.`}
        subtitle="A clear view of your day. A little room to breathe."
      >
        <Button variant="secondary" onClick={() => setEditor(true)}>
          <Plus size={16} /> Add a task
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
                <Sparkles size={14} /> YOUR DAILY PERSPECTIVE
              </span>
              <h2>
                A more intentional day
                <br />
                starts with a little clarity.
              </h2>
              <p>
                {data?.briefing
                  ? "Your latest briefing brings the important things together."
                  : "Let your assistant connect the dots between your plans, priorities and what matters to you."}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  void generate();
                }}
                disabled={action.pending}
              >
                {action.pending ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Sparkles size={15} />
                )}{" "}
                Generate my briefing <ArrowUpRight size={15} />
              </Button>
              <span className="hero-footnote">
                From your tasks, calendar & confirmed memories
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
                label: "Open tasks",
                value: data?.stats.tasks,
                icon: CheckCircle2,
                note: "One thing at a time",
                route: "tasks",
              },
              {
                label: "Memories",
                value: data?.stats.memories,
                icon: Brain,
                note: "Your personal context",
                route: "memory",
              },
              {
                label: "Automations",
                value: data?.stats.automations,
                icon: Zap,
                note: "Working in the background",
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
                  <CheckCircle2 size={18} /> In your focus
                </h2>
                <p>A few things to move forward.</p>
              </div>
              <Link href="/tasks" className="text-link">
                All tasks <ArrowRight size={14} />
              </Link>
            </div>
            {query.isPending ? (
              <Loading />
            ) : !data?.tasks.filter(
                (t) => !["done", "cancelled"].includes(t.status || ""),
              ).length ? (
              <Empty
                title="A little breathing room."
                text="Capture something you want to get done. We'll keep it in view."
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditor(true)}
                  >
                    <Plus size={14} /> Add your first task
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
                <Sparkles size={14} /> YOUR BRIEFING
              </span>
              <h2>
                {(briefing || data?.briefing)?.title || "A view of your day"}
              </h2>
              <div className="prose-content">
                {(briefing || data?.briefing)?.content}
              </div>
            </section>
          )}
          <section className="panel briefing-history">
            <details>
              <summary>
                <History size={16} /> Previous briefings{" "}
                <span>{briefingHistory.data?.length || 0}</span>
              </summary>
              <Failure error={briefingHistory.error} />
              {briefingHistory.data?.length ? (
                briefingHistory.data.map((item) => (
                  <details className="briefing-history-item" key={item.id}>
                    <summary>
                      {item.title || "Daily briefing"}
                      <time>
                        {dateLabel(item.created_at)} ·{" "}
                        {timeLabel(item.created_at)}
                      </time>
                    </summary>
                    <div className="prose-content">{item.content}</div>
                  </details>
                ))
              ) : (
                <p>Your generated briefings will appear here.</p>
              )}
            </details>
          </section>
          <section className="assistant-banner">
            <span className="assistant-icon">
              <Sparkles size={24} />
            </span>
            <div>
              <h3>Thinking out loud is a good place to start.</h3>
              <p>Make a plan, untangle an idea, or simply ask a question.</p>
            </div>
            <Link
              href="/chat"
              className="circle-arrow"
              aria-label="Open AI assistant"
            >
              <ArrowUpRight size={22} />
            </Link>
          </section>
        </div>
        <aside className="dashboard-aside">
          <section className="panel calendar-preview">
            <div className="panel-heading">
              <h2>
                <CalendarDays size={17} /> On the horizon
              </h2>
              <Link href="/calendar" aria-label="Open calendar">
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
                      {date.toLocaleDateString("en", { weekday: "narrow" })}
                    </span>
                    <strong>{date.getDate()}</strong>
                  </div>
                );
              })}
            </div>
            {data?.events.length ? (
              <div className="agenda-list">
                {data.events.slice(0, 4).map((event) => (
                  <div className="agenda-item" key={event.id}>
                    <span className="agenda-time">
                      {timeLabel(event.start_at)}
                    </span>
                    <div>
                      <strong>{event.title}</strong>
                      <small>
                        {dateLabel(event.start_at)} ·{" "}
                        {event.provider || "local"}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="quiet-empty">
                <CalendarDays size={23} strokeWidth={1.2} />
                <strong>Your calendar has space.</strong>
                <p>Add an event or connect a calendar to see what’s ahead.</p>
                <Link href="/calendar">
                  Open calendar <ArrowRight size={13} />
                </Link>
              </div>
            )}
          </section>
          <section className="panel memory-preview">
            <span className="small-icon">
              <Brain size={20} />
            </span>
            <h2>
              A second brain,
              <br />
              with your permission.
            </h2>
            <p>
              Keep the context that matters. You decide what stays, changes, or
              goes.
            </p>
            <Link href="/memory" className="text-link">
              Explore your memory <ArrowRight size={14} />
            </Link>
            <div className="memory-note">
              <LockKeyhole size={13} /> Nothing remembered without your say.
            </div>
          </section>
          <div className="day-note">
            <span>✳</span>
            <p>
              Progress doesn’t have to be loud.
              <br />
              One meaningful thing is enough.
            </p>
            <small>A LITTLE REMINDER</small>
          </div>
          {!!data?.stats.approvals && (
            <Link className="approval-nudge" href="/activity">
              <ShieldCheck size={20} />
              <span>
                {data.stats.approvals} action
                {data.stats.approvals === 1 ? "" : "s"} waiting for your
                approval
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
  const action = useAction();
  return (
    <div className={`task-row ${item.status === "done" ? "task-done" : ""}`}>
      <button
        className="task-check"
        disabled={action.pending}
        aria-label={item.status === "done" ? "Reopen task" : "Complete task"}
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
            {item.priority || "medium"}
          </span>
          {item.due_at && (
            <span>
              <CalendarDays size={12} />
              {dateLabel(item.due_at)}
            </span>
          )}
          {!compact && <Badge status={item.status} />}
        </div>
        {action.error && <span className="inline-error">{action.error}</span>}
      </div>
      {!compact && <RowActions onEdit={onEdit} onDelete={onDelete} />}
      {compact && (
        <Link href="/tasks" aria-label="View task">
          <ChevronRight size={17} />
        </Link>
      )}
    </div>
  );
}
export function TasksPage() {
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
        eyebrow="MAKE SPACE FOR PROGRESS"
        title="One thing at a time."
        subtitle="Get it out of your head and into a plan."
      >
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> Add task
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
                ? "To do"
                : value === "done"
                  ? "Completed"
                  : "All tasks"}
              <span>
                {
                  (query.data || []).filter(
                    (t) =>
                      value === "all" ||
                      (value === "done"
                        ? t.status === "done"
                        : !["done", "cancelled"].includes(t.status || "")),
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a task…"
            aria-label="Find a task"
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
        ) : records.length ? (
          records.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              onEdit={() => setEdit(item)}
              onDelete={() => {
                if (confirm(`Delete “${item.title}”?`))
                  void action.run(() => remove("tasks", item));
              }}
            />
          ))
        ) : (
          <Empty
            icon={<CheckCircle2 size={29} strokeWidth={1.3} />}
            title={
              search
                ? "No tasks found."
                : filter === "done"
                  ? "Your wins will live here."
                  : "Every good plan starts somewhere."
            }
            text={
              search
                ? "Try a different search or filter."
                : "Capture a task, set a priority, and take it one step at a time."
            }
            action={
              <Button variant="secondary" onClick={() => setEdit("new")}>
                <Plus size={15} /> Add a task
              </Button>
            }
          />
        )}
      </section>
      <div className="subtle-tip">
        <Sparkles size={15} /> Prefer to think out loud?{" "}
        <Link href="/chat">
          Ask your assistant to create a task <ArrowUpRight size={13} />
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
      api<RecordItem[]>(`/memories?q=${encodeURIComponent(debouncedSearch)}`, {
        signal,
      }),
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
        eyebrow="CONTEXT, WITH CONSENT"
        title="A place for what matters."
        subtitle="Your preferences, goals and important details. Always yours to control."
      >
        <Button
          variant="secondary"
          onClick={() => {
            void action.run(downloadExport);
          }}
        >
          <ArrowDownToLine size={15} /> Export
        </Button>
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> Add memory
        </Button>
      </PageHeader>
      <div className="info-strip">
        <ShieldCheck size={20} />
        <div>
          <strong>You choose what stays.</strong>
          <span>
            {" "}
            Suggestions wait for your confirmation before becoming long-term
            context.
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
                  ? "All memories"
                  : value === "pending"
                    ? "To review"
                    : value[0].toUpperCase() + value.slice(1)}
              </button>
            ),
          )}
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            placeholder="Search your memories…"
            aria-label="Search memories"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <Failure error={query.error} />
      <ErrorText text={action.error} />
      {query.isPending || search.trim() !== debouncedSearch ? (
        <Loading />
      ) : !records.length ? (
        <section className="panel">
          <Empty
            icon={<Brain size={30} strokeWidth={1.3} />}
            title={
              debouncedSearch
                ? "Nothing matched that memory."
                : "A fresh page for your story."
            }
            text={
              debouncedSearch
                ? "Try another phrase or category. Your search runs against your saved memories on the server."
                : "Add something worth remembering. Your assistant will use confirmed memories to understand you better."
            }
            action={
              <Button variant="secondary" onClick={() => setEdit("new")}>
                <Plus size={14} /> Save a memory
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
                  {item.category?.replaceAll("_", " ") || "fact"}
                </span>
                <Badge status={item.status} />
              </div>
              <p>{item.content}</p>
              <div className="memory-source">
                <FileText size={12} />
                {item.source?.startsWith("chat:") ? (
                  <Link
                    className="text-link"
                    title={item.source}
                    href={`/chat?session=${encodeURIComponent(item.source.slice(5))}`}
                  >
                    Source conversation <ArrowUpRight size={11} />
                  </Link>
                ) : (
                  <span title={item.source}>
                    {item.source || "Added by you"}
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
                  <Check size={14} /> Confirm memory
                </Button>
              )}
              <div className="memory-card-bottom">
                <span>Version {item.version}</span>
                <RowActions
                  onEdit={() => setEdit(item)}
                  onDelete={() => {
                    if (
                      confirm(
                        "Delete this memory? It will stop being used for future recall.",
                      )
                    )
                      void action.run(() => remove("memory", item));
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

export function CalendarPage() {
  const query = useRecords("calendar");
  const [showGoogle, setShowGoogle] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date().toDateString());
  const [edit, setEdit] = useState<RecordItem | "new">();
  const action = useAction();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstCell = new Date(first);
  firstCell.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(firstCell);
    d.setDate(d.getDate() + i);
    return d;
  });
  const google = useQuery({
    queryKey: ["google-events", month.toISOString()],
    enabled: showGoogle,
    queryFn: () =>
      api<
        {
          id: string;
          summary?: string;
          description?: string;
          htmlLink?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
        }[]
      >(
        `/calendar/google/events?start=${encodeURIComponent(new Date(month.getFullYear(), month.getMonth(), 1).toISOString())}&end=${encodeURIComponent(new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString())}`,
      ),
  });
  const calendarRecords: RecordItem[] = showGoogle
    ? (google.data || []).map((event) => ({
        id: event.id,
        title: event.summary || "Untitled event",
        content: event.description,
        start_at: event.start?.dateTime || event.start?.date,
        end_at: event.end?.dateTime || event.end?.date,
        provider: "google",
        version: 0,
        created_at: "",
        url: event.htmlLink,
      }))
    : query.data || [];
  const agenda = calendarRecords
    .filter(
      (item) =>
        item.start_at && new Date(item.start_at).toDateString() === selected,
    )
    .sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));
  async function connect() {
    await action.run(async () => {
      const result = await api<{ authorization_url: string }>(
        "/calendar/oauth/start",
      );
      window.location.assign(result.authorization_url);
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="TIME, THOUGHTFULLY SPENT"
        title="Make room in your day."
        subtitle="A little structure, a little breathing room."
      >
        <Button
          variant="secondary"
          onClick={() => {
            void connect();
          }}
          disabled={action.pending}
        >
          <Network size={15} /> Connect Google Calendar
        </Button>
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> New event
        </Button>
      </PageHeader>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={!showGoogle ? "selected" : ""}
            onClick={() => setShowGoogle(false)}
          >
            PersonalOS calendar
          </button>
          <button
            className={showGoogle ? "selected" : ""}
            onClick={() => setShowGoogle(true)}
          >
            Google Calendar
          </button>
        </div>
        <span className="small-text">
          {showGoogle
            ? "Live provider events · OAuth required"
            : "Local workspace events"}
        </span>
      </div>
      <Failure error={showGoogle ? google.error : query.error} />
      <ErrorText text={action.error} />
      <div className="calendar-layout">
        <section className="panel calendar-panel">
          <div className="calendar-controls">
            <h2>
              {month.toLocaleDateString("en", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMonth(new Date())}
              >
                Today
              </Button>
              <button
                className="icon-button"
                aria-label="Previous month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() - 1, 1),
                  )
                }
              >
                <ChevronLeft size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Next month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() + 1, 1),
                  )
                }
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </div>
          <div className="calendar-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          {query.isPending ? (
            <Loading />
          ) : (
            <div className="calendar-days">
              {days.map((day) => {
                const events = calendarRecords.filter(
                  (e) =>
                    e.start_at &&
                    new Date(e.start_at).toDateString() === day.toDateString(),
                );
                return (
                  <button
                    key={day.toISOString()}
                    className={`calendar-day ${day.getMonth() !== month.getMonth() ? "other-month" : ""} ${selected === day.toDateString() ? "selected-day" : ""} ${day.toDateString() === new Date().toDateString() ? "current-day" : ""}`}
                    onClick={() => setSelected(day.toDateString())}
                  >
                    <span>{day.getDate()}</span>
                    {events.slice(0, 2).map((e) => (
                      <small key={e.id}>{e.title}</small>
                    ))}
                    {events.length > 2 && <em>+{events.length - 2} more</em>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel day-agenda">
          <span className="eyebrow">YOUR DAY</span>
          <h2>
            {new Date(selected).toLocaleDateString("en", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </h2>
          {agenda.length ? (
            agenda.map((item) => (
              <article className="event-card" key={item.id}>
                <span className="eyebrow">
                  {timeLabel(item.start_at)} — {timeLabel(item.end_at)}
                </span>
                <h3>{item.title}</h3>
                <p>{item.content}</p>
                <Badge status={item.provider || "local"} />
                {item.provider === "google" && (
                  <a
                    className="text-link"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Google Calendar <ArrowUpRight size={13} />
                  </a>
                )}
                <RowActions
                  onEdit={() => setEdit(item)}
                  onDelete={() => {
                    if (confirm(`Delete “${item.title}”?`))
                      void action.run(async () => {
                        if (item.provider === "google") {
                          await api(
                            `/calendar/google/events/${encodeURIComponent(item.id)}`,
                            { method: "DELETE" },
                          );
                          alert(
                            "Google Calendar deletion is awaiting your approval in Activity & approvals.",
                          );
                        } else await remove("calendar", item);
                      });
                  }}
                />
                {item.provider === "google" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          "Request undo for this external event? A deletion approval will be created.",
                        )
                      )
                        void action.run(async () => {
                          await api(
                            `/calendar/google/events/${encodeURIComponent(item.id)}/undo`,
                            { method: "POST" },
                          );
                          alert(
                            "Undo request is awaiting approval in Activity & approvals.",
                          );
                        });
                    }}
                  >
                    <RefreshCw size={12} /> Request undo
                  </Button>
                )}
              </article>
            ))
          ) : (
            <Empty
              icon={<CalendarDays size={26} />}
              title="A clear stretch of time."
              text="There are no events on this day. Add something intentional."
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEdit("new")}
                >
                  <Plus size={14} /> Add event
                </Button>
              }
            />
          )}
        </section>
      </div>
      <div className="subtle-tip">
        <ShieldCheck size={15} /> Connected calendar writes require approval.
        Local events stay in your workspace.
      </div>
      {edit && (
        <ResourceEditor
          kind="calendar"
          item={edit === "new" ? undefined : edit}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
export function AutomationsPage() {
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
        eyebrow="LET THE LITTLE THINGS RUN"
        title="A little help, on repeat."
        subtitle="Thoughtful routines that work quietly in the background."
      >
        <Button onClick={() => setEdit("new")}>
          <Plus size={16} /> Create automation
        </Button>
      </PageHeader>
      <div className="automation-intro">
        <span className="intro-symbol">
          <Zap size={25} />
        </span>
        <div>
          <h3>From intention to a dependable routine.</h3>
          <p>
            Schedule a briefing or an assistant task. Your independent worker
            keeps track of runs, retries and approvals.
          </p>
        </div>
        <span className="outline-tag">
          <ShieldCheck size={13} /> Permission aware
        </span>
      </div>
      <Failure error={query.error} />
      <ErrorText text={action.error} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.length ? (
        <section className="panel">
          <Empty
            icon={<Zap size={29} strokeWidth={1.3} />}
            title="Let a routine carry a little weight."
            text="Create your first automation. A morning briefing is a good place to start."
            action={
              <Button variant="secondary" onClick={() => setEdit("new")}>
                <Plus size={15} /> Create a routine
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
                      <FileText size={13} /> Daily briefing
                    </span>
                  )}
                  <span>
                    <Clock3 size={13} />
                    <code>{item.cron || "One time"}</code> · {item.timezone}
                  </span>
                  <span>
                    Next:{" "}
                    {item.next_run_at
                      ? `${dateLabel(item.next_run_at)} ${timeLabel(item.next_run_at)}`
                      : "Not scheduled"}
                  </span>
                </div>
                <Link href="/activity" className="text-link">
                  <History size={13} /> View execution history
                </Link>
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
                      ? "Pause automation"
                      : "Resume automation"
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
                  aria-label="Retry automation"
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
                  aria-label="Edit automation"
                  onClick={() => setEdit(item)}
                >
                  <Edit3 size={16} />
                </button>
                <button
                  className="icon-button delete"
                  aria-label="Cancel automation"
                  disabled={action.pending || item.status === "cancelled"}
                  onClick={() => {
                    if (
                      confirm(
                        "Cancel this automation? It will no longer be scheduled.",
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
export function IntegrationsPage() {
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
  async function connectCalendar() {
    await action.run(async () => {
      const result = await api<{ authorization_url: string }>(
        "/calendar/oauth/start",
      );
      window.location.assign(result.authorization_url);
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="CONNECTED, ON YOUR TERMS"
        title="Bring your world together."
        subtitle="Useful tools. Clear permissions. You stay in charge."
      >
        <Button onClick={() => setEdit(true)}>
          <Plus size={16} /> Add MCP server
        </Button>
      </PageHeader>
      <div className="integration-grid">
        <section className="panel integration-feature">
          <div className="integration-brand google-icon">
            <CalendarDays size={25} />
          </div>
          <span className="outline-tag">OAuth 2.0</span>
          <h2>Google Calendar</h2>
          <p>
            Bring your schedule into focus. View events, check conflicts, and
            approve changes before they happen.
          </p>
          <ul>
            <li>
              <Check size={14} /> Secure provider authorization
            </li>
            <li>
              <Check size={14} /> No account password shared
            </li>
            <li>
              <Check size={14} /> External writes require approval
            </li>
          </ul>
          <Button
            variant="secondary"
            onClick={() => {
              void connectCalendar();
            }}
            disabled={action.pending}
          >
            Connect calendar <ArrowUpRight size={15} />
          </Button>
        </section>
        <section className="panel integration-feature">
          <div className="integration-brand">
            <Network size={25} />
          </div>
          <span className="outline-tag">MCP</span>
          <h2>A workspace that can do more.</h2>
          <p>
            Connect trusted tool servers using the Model Context Protocol.
            Review the available tools and grant only the permissions you need.
          </p>
          <div className="integration-caution">
            <LockKeyhole size={16} />
            <span>
              New servers start untrusted. Connecting doesn’t grant permission
              to execute.
            </span>
          </div>
          <Button variant="ghost" onClick={() => setEdit(true)}>
            Add a tool server <Plus size={14} />
          </Button>
        </section>
      </div>
      <div className="section-title">
        <h2>Your connections</h2>
        <span>{query.data?.length || 0} connected configurations</span>
      </div>
      <Failure error={query.error} />
      <ErrorText text={action.error} />
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : !query.data?.length ? (
          <Empty
            icon={<Network size={27} />}
            title="An open door, when you're ready."
            text="No services are connected yet. Your workspace works locally while you choose what to connect."
          />
        ) : (
          query.data.map((item) => (
            <div className="connection-row" key={item.id}>
              <span className="connection-icon">
                {item.kind === "google_calendar" ? (
                  <CalendarDays size={20} />
                ) : (
                  <Network size={20} />
                )}
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.url || item.kind}</p>
                <small>
                  Permissions: {item.permissions?.join(", ") || "None granted"}
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
                    Review tools
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() => {
                      if (
                        confirm(
                          `${item.trusted ? "Revoke trust for" : "Trust"} this server? Review its origin before authorizing.`,
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
                    {item.trusted ? "Revoke trust" : "Trust server"}
                  </Button>
                </>
              )}
              {item.kind === "google_calendar" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (
                      confirm(
                        "Disconnect Google Calendar and revoke this authorization?",
                      )
                    )
                      void action.run(async () => {
                        await api(`/integrations/${item.id}/disconnect`, {
                          method: "POST",
                        });
                        alert(
                          "Disconnection awaits your approval in Activity & approvals.",
                        );
                      });
                  }}
                >
                  Disconnect
                </Button>
              )}
              <button
                className="icon-button delete"
                aria-label="Remove connection"
                onClick={() => {
                  if (confirm("Remove this connection?"))
                    void action.run(() => remove("integrations", item));
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
              <h2 id="tool-heading">Tools · {tools.item.title}</h2>
              <button
                className="icon-button"
                aria-label="Close tools"
                onClick={() => setTools(undefined)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              Read the server’s tool descriptions before granting permission.
              Descriptions come from the server and are untrusted content.
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
                  <p>{String(tool.description || "No description supplied")}</p>
                  <details>
                    <summary>Input schema</summary>
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
              Call a granted tool
              <select
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value)}
              >
                <option value="">Select tool…</option>
                {tools.tools.map((t) => (
                  <option key={String(t.name)} value={String(t.name)}>
                    {String(t.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Arguments (JSON)
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
              Request tool execution <ArrowUpRight size={15} />
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

export function ActivityPage() {
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
  return (
    <>
      <PageHeader
        eyebrow="TRANSPARENCY, BUILT IN"
        title="Nothing behind the scenes."
        subtitle="Review requests, follow executions, and see what your assistant did."
      >
        <Button
          variant="secondary"
          onClick={() => {
            void query.refetch();
            void approvals.refetch();
            void decisions.refetch();
          }}
        >
          <RefreshCw size={15} /> Refresh
        </Button>
      </PageHeader>
      <ErrorText text={action.error} />
      {!!pending.length && (
        <section className="approvals-section">
          <div className="section-title">
            <h2>
              <ShieldCheck size={18} /> Waiting for your say
            </h2>
            <span>{pending.length} pending</span>
          </div>
          {pending.map((item) => (
            <article className="panel approval-card" key={item.id}>
              <div className="approval-card-head">
                <span className="approval-symbol">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <h3>{item.title || "Tool execution request"}</h3>
                  <p>
                    Review the exact parameters before allowing this action.
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
                  <LockKeyhole size={13} /> Your approval is bound to these
                  arguments.
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
                  Reject
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
                  <Check size={14} /> Approve action
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
      <div className="toolbar">
        <div className="tabs">
          {["all", "approvals", "decisions"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={tab === t ? "selected" : ""}
            >
              {t === "all"
                ? "Execution history"
                : t === "approvals"
                  ? "All approvals"
                  : "Routing decisions"}
            </button>
          ))}
        </div>
        <span className="small-text">
          <ShieldCheck size={13} /> An accountable assistant
        </span>
      </div>
      <Failure
        error={
          tab === "approvals"
            ? approvals.error
            : tab === "decisions"
              ? decisions.error
              : query.error
        }
      />
      <section className="panel">
        {(
          tab === "approvals"
            ? approvals.isPending
            : tab === "decisions"
              ? decisions.isPending
              : query.isPending
        ) ? (
          <Loading />
        ) : !(
            tab === "approvals"
              ? approvals.data
              : tab === "decisions"
                ? decisions.data
                : query.data
          )?.length ? (
          <Empty
            icon={<History size={28} strokeWidth={1.3} />}
            title="A clear, quiet record."
            text="Actions, permissions and execution outcomes will appear here as you use your workspace."
          />
        ) : (
          <div className="activity-list">
            {(tab === "approvals"
              ? approvals.data
              : tab === "decisions"
                ? decisions.data
                : query.data
            )?.map((item) => (
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
                      "Execution"}
                  </h3>
                  <p>{item.content || item.summary || item.error}</p>
                  <details>
                    <summary>View details</summary>
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
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const settingsForm = useRef<HTMLFormElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    setSaved(false);
    const payload: Record<string, unknown> = {
      name: data.get("name"),
      model: data.get("model"),
      decision_provider: data.get("decision_provider"),
      base_url: data.get("base_url"),
      timezone: data.get("timezone"),
      memory_enabled: data.get("memory_enabled") === "on",
      version: query.data?.version,
    };
    if (data.get("api_key")) payload.api_key = data.get("api_key");
    for (const field of ["fast_model", "reasoning_model"]) {
      const value = String(data.get(field) || "").trim();
      if (value) payload[field] = value;
    }
    const ok = await action.run(() =>
      api("/settings", { method: "PATCH", body: JSON.stringify(payload) }),
    );
    if (ok) {
      setSaved(true);
      const keyInput = formElement.elements.namedItem("api_key");
      if (keyInput instanceof HTMLInputElement) keyInput.value = "";
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, YOUR WAY"
        title="Make it feel like you."
        subtitle="Your model, your privacy, your preferences."
      />
      <Failure error={query.error} />
      <ErrorText text={action.error} />
      {saved && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={17} /> Your settings have been saved.
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : (
        query.data && (
          <div className="settings-layout">
            <form
              className="settings-form"
              ref={settingsForm}
              onSubmit={(e) => {
                void submit(e);
              }}
            >
              <section className="panel settings-section">
                <div className="settings-section-heading">
                  <span className="small-icon">
                    <Bot size={21} />
                  </span>
                  <div>
                    <h2>Your AI model</h2>
                    <p>
                      Connect an OpenAI-compatible model provider. Keys stay
                      encrypted on the server.
                    </p>
                  </div>
                </div>
                <div className="provider-presets">
                  <span>Quick setup</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const form = settingsForm.current;
                      if (!form) return;
                      const model = form.elements.namedItem("model");
                      const base = form.elements.namedItem("base_url");
                      if (model instanceof HTMLInputElement)
                        model.value = "deepseek-flash";
                      if (base instanceof HTMLInputElement)
                        base.value = "https://api.deepseek.com";
                      const fastModel = form.elements.namedItem("fast_model");
                      const reasoningModel =
                        form.elements.namedItem("reasoning_model");
                      if (fastModel instanceof HTMLInputElement)
                        fastModel.value = "deepseek-flash";
                      if (reasoningModel instanceof HTMLInputElement)
                        reasoningModel.value = "deepseek-v4-pro";
                      setSaved(false);
                    }}
                  >
                    DeepSeek <ArrowUpRight size={13} />
                  </Button>
                  <span className="field-note">
                    Applies a preset. Add your key, then save.
                  </span>
                </div>
                <div className="form-grid">
                  <label>
                    Model ID
                    <input
                      name="model"
                      defaultValue={String(query.data.model || "")}
                      placeholder="e.g. gpt-4.1-mini"
                      required
                    />
                  </label>
                  <label>
                    Provider base URL
                    <input
                      name="base_url"
                      type="url"
                      defaultValue={String(query.data.base_url || "")}
                      placeholder="https://api.openai.com/v1"
                      required
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Fast routing model{" "}
                    <span className="label-meta">optional</span>
                    <input
                      name="fast_model"
                      defaultValue={String(query.data.fast_model || "")}
                      placeholder="Leave blank to use the main model"
                    />
                  </label>
                  <label>
                    Reasoning routing model{" "}
                    <span className="label-meta">optional</span>
                    <input
                      name="reasoning_model"
                      defaultValue={String(query.data.reasoning_model || "")}
                      placeholder="Leave blank to use the main model"
                    />
                  </label>
                </div>
                <div className="field-note">
                  Optional routing overrides for quick decisions and complex
                  work. Selecting a preset only fills the form; save to apply.
                </div>
                <label>
                  How to route requests
                  <select
                    name="decision_provider"
                    defaultValue={String(
                      query.data.decision_provider || "rules",
                    )}
                  >
                    <option value="rules">Fast rules · default</option>
                    <option value="llm">Your language model</option>
                    <option value="jev">
                      Jev · requires server authorization
                    </option>
                  </select>
                </label>
                <div className="field-note">
                  <ShieldCheck size={13} /> Routing chooses a model; sensitive
                  actions still require your approval.
                </div>
                <label>
                  API key{" "}
                  <span className="label-meta">
                    {query.data.api_key_configured
                      ? "A key is securely configured"
                      : "No key configured"}
                  </span>
                  <input
                    name="api_key"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      query.data.api_key_configured
                        ? "Leave blank to keep the current key"
                        : "Enter your provider API key"
                    }
                  />
                </label>
                <div className="field-note">
                  <LockKeyhole size={13} /> Existing API keys are never returned
                  to your browser.
                </div>
                {query.data.api_key_configured && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          "Remove the configured model API key? Chat and AI briefings will become unavailable.",
                        )
                      )
                        void action.run(() =>
                          api("/settings", {
                            method: "PATCH",
                            body: JSON.stringify({
                              api_key: "",
                              version: query.data?.version,
                            }),
                          }),
                        );
                    }}
                  >
                    Remove API key
                  </Button>
                )}
              </section>
              <section className="panel settings-section">
                <div className="settings-section-heading">
                  <span className="small-icon">
                    <Brain size={21} />
                  </span>
                  <div>
                    <h2>Memory & preferences</h2>
                    <p>
                      Choose how your workspace remembers and organizes your
                      day.
                    </p>
                  </div>
                </div>
                <div className="toggle-field">
                  <div>
                    <strong>Suggest long-term memories</strong>
                    <p>
                      Your assistant can propose useful context. You confirm
                      what gets saved.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    name="memory_enabled"
                    className="switch"
                    defaultChecked={query.data.memory_enabled ?? true}
                    aria-label="Suggest long-term memories"
                  />
                </div>
                <div className="form-grid">
                  <label>
                    Display name
                    <input
                      name="name"
                      defaultValue={String(query.data.name || user.name || "")}
                    />
                  </label>
                  <label>
                    Time zone
                    <input
                      name="timezone"
                      defaultValue={String(
                        query.data.timezone ||
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
                    ? "Changes saved"
                    : "Changes apply to your account only."}
                </span>
                <Button type="submit" disabled={action.pending}>
                  {action.pending ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Check size={15} />
                  )}{" "}
                  Save changes
                </Button>
              </div>
            </form>
            <aside>
              <section className="panel privacy-card">
                <ShieldCheck size={27} strokeWidth={1.3} />
                <h2>
                  Private by design.
                  <br />
                  Controlled by you.
                </h2>
                <p>
                  Your assistant uses your context to help you. You decide what
                  it knows and what it can do.
                </p>
                <ul>
                  <li>
                    <Check size={13} /> User-isolated workspace data
                  </li>
                  <li>
                    <Check size={13} /> Keys held on the server
                  </li>
                  <li>
                    <Check size={13} /> Explicit action approvals
                  </li>
                  <li>
                    <Check size={13} /> Export and delete your memories
                  </li>
                </ul>
              </section>
              <section className="panel data-card">
                <h3>Your data travels with you.</h3>
                <p>
                  Download your workspace as a JSON archive. API keys and
                  authorization tokens are excluded.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void action.run(downloadExport);
                  }}
                >
                  <ArrowDownToLine size={14} /> Export workspace
                </Button>
                <div className="data-divider" />
                <h3>Start a fresh memory.</h3>
                <p>
                  Review and remove individual memories in your memory center.
                  Deletions require your approval.
                </p>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/memory">
                    <Brain size={14} /> Manage memories
                  </Link>
                </Button>
                <div className="data-divider" />
                <h3>Close your account.</h3>
                <p>
                  Request deletion of your workspace, memories, conversations
                  and saved credentials. Review and approve the request in
                  Activity before deletion takes place.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={action.pending}
                  onClick={() => {
                    if (
                      prompt(
                        "Type DELETE to request permanent account deletion. You will still need to approve the exact request in Activity.",
                      ) === "DELETE"
                    )
                      void action.run(async () => {
                        await api("/account/delete", {
                          method: "POST",
                          body: JSON.stringify({ confirmation: "DELETE" }),
                        });
                        alert(
                          "Your account deletion request is awaiting approval in Activity & approvals.",
                        );
                      });
                  }}
                >
                  <Trash2 size={13} /> Request account deletion
                </Button>
              </section>
              <div className="account-note">
                <span className="user-avatar">
                  {user.email[0].toUpperCase()}
                </span>
                <div>
                  <strong>{user.email}</strong>
                  <small>Signed in to your personal account</small>
                </div>
              </div>
            </aside>
          </div>
        )
      )}
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
  const client = useQueryClient();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<RecordItem[]>("/chat/sessions"),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
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
    const text = input.trim();
    setInput("");
    setError(undefined);
    setEvents([]);
    setPending(true);
    controller.current = new AbortController();
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
        signal: controller.current.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : "The model provider could not complete this request.",
        );
      }
      if (!response.body) throw new Error("This response has no stream.");
      const reader = response.body.getReader();
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
        if (update.type === "token")
          setMessages((prev) =>
            (prev || []).map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + (update.content || "") }
                : m,
            ),
          );
        else if (update.type === "done") {
          if (update.session_id) setSession(update.session_id);
        } else if (update.type === "error")
          throw new Error(
            update.message ||
              update.content ||
              "The assistant encountered an error.",
          );
        else setEvents((prev) => [...prev.slice(-19), update]);
      }
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder
          .decode(value, { stream: true })
          .replaceAll("\r\n", "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          consume(frame);
        }
      }
      if (buffer.trim()) consume(buffer);
      await client.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError")
        setError("Generation stopped. Any completed content is shown above.");
      else
        setError(
          err instanceof Error ? err.message : "Couldn't reach your assistant.",
        );
    } finally {
      setPending(false);
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
        eyebrow="A THOUGHTFUL COLLABORATOR"
        title="A little perspective helps."
        subtitle="Plan something, ask a question, or think out loud."
      >
        <Button variant="secondary" onClick={newChat} disabled={pending}>
          <Plus size={15} /> New conversation
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
              <span>Your personal assistant</span>
            </div>
            <label className="model-picker">
              <span className="sr-only">Model</span>
              <input
                aria-label="Model ID"
                placeholder={String(
                  settings.data?.model || "Model not configured",
                )}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={pending}
              />
              <span
                className={
                  settings.data?.api_key_configured
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
                <span className="eyebrow">A LITTLE MORE HEADSPACE</span>
                <h2>What’s on your mind?</h2>
                <p>
                  There’s no perfect way to start.
                  <br />
                  Bring a thought, a task, or a little everyday chaos.
                </p>
                <div className="chat-suggestions">
                  {[
                    { icon: CalendarDays, text: "Help me plan my day" },
                    { icon: Brain, text: "What do you remember about me?" },
                    { icon: CheckCircle2, text: "Help me break down a task" },
                    { icon: Leaf, text: "What should I focus on next?" },
                  ].map(({ icon: Icon, text }) => (
                    <button onClick={() => setInput(text)} key={text}>
                      <Icon size={17} />
                      <span>{text}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                {settings.data && !settings.data.api_key_configured && (
                  <div className="chat-setup-note">
                    <LockKeyhole size={15} /> Add a model API key in{" "}
                    <Link href="/settings">Settings</Link> to start a real
                    conversation.
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
                      "You"
                    )}
                  </span>
                  <div>
                    <strong>
                      {message.role === "assistant" ? "PersonalOS" : "You"}
                    </strong>
                    <div className="message-content">
                      {message.content ||
                        (pending ? (
                          <span className="typing-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          <span className="small-text">
                            No answer was generated.
                          </span>
                        ))}
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
                <Zap size={13} /> {events.length} execution update
                {events.length === 1 ? "" : "s"}
              </summary>
              {events.map((item, i) => (
                <div key={i}>
                  <span className="tiny-dot" />
                  <strong>
                    {item.tool || item.name || item.status || item.type}
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
          <form
            className="chat-composer"
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="A thought, a plan, a question…"
              aria-label="Message your assistant"
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
                <ShieldCheck size={12} /> You approve sensitive actions.
              </span>
              {pending ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={() => controller.current?.abort()}
                  aria-label="Stop generation"
                >
                  <X size={18} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim()}
                  aria-label="Send message"
                >
                  <ArrowUpRight size={19} />
                </Button>
              )}
            </div>
          </form>
          <p className="chat-disclaimer">
            AI can make mistakes. Keep a human eye on important details.
          </p>
        </section>
        <aside className="chat-aside">
          <div className="panel-heading">
            <h3>Conversations</h3>
            <button
              className="icon-button"
              aria-label="New conversation"
              onClick={newChat}
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
              <strong>A fresh conversation.</strong>
              <p>Your saved conversations will appear here.</p>
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
                }}
              >
                <MessageSquare size={15} />
                <span>
                  {item.title || "Conversation"}
                  <small>{dateLabel(item.updated_at || item.created_at)}</small>
                </span>
              </button>
            ))
          )}
          <div className="chat-context-note">
            <Brain size={20} />
            <h3>Context that belongs to you.</h3>
            <p>
              Your assistant recalls confirmed memories to make its answers more
              relevant.
            </p>
            <Link href="/memory" className="text-link">
              Review your memories <ArrowRight size={13} />
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
  onClose,
}: {
  kind: string;
  item?: RecordItem;
  onClose: () => void;
}) {
  const action = useAction();
  const [category, setCategory] = useState(item?.category || "fact");
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
        status: string("confirmed") === "on" ? "confirmed" : "pending",
        source: item?.source || "Added manually by user",
      });
    if (kind === "calendar")
      Object.assign(body, {
        title: string("title"),
        content: string("content"),
        start_at: new Date(string("start_at")).toISOString(),
        end_at: new Date(string("end_at")).toISOString(),
        provider: item?.provider === "google" ? "google" : string("provider"),
      });
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
    const ok = await action.run(async () => {
      const result = await api<{ approval_required?: boolean }>(
        kind === "calendar" && item?.provider === "google"
          ? `/calendar/google/events/${encodeURIComponent(item.id)}`
          : `${resourcePaths[kind]}${item ? `/${item.id}` : ""}`,
        { method: item ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      if (result?.approval_required)
        alert(
          "This action has been sent for your approval. Review it in Activity & approvals.",
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
            <span className="eyebrow">A LITTLE MORE INTENTION</span>
            <h2 id="editor-title">
              {item ? "Edit" : "Add"} {titles[kind]}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close editor"
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
              {kind === "integrations" ? "Server name" : "Title"}
              <input
                name="title"
                autoFocus
                defaultValue={item?.title || ""}
                placeholder={
                  kind === "tasks"
                    ? "What would you like to move forward?"
                    : kind === "automations"
                      ? "e.g. A thoughtful morning briefing"
                      : kind === "integrations"
                        ? "A name you'll recognize"
                        : "What’s happening?"
                }
                required
                maxLength={240}
              />
            </label>
          )}
          {["tasks", "calendar"].includes(kind) && (
            <label>
              Notes <span className="label-meta">optional</span>
              <textarea
                name="content"
                rows={3}
                defaultValue={item?.content || ""}
                placeholder="A little helpful context…"
              />
            </label>
          )}
          {kind === "tasks" && (
            <>
              <div className="form-grid">
                <label>
                  Priority
                  <select
                    name="priority"
                    defaultValue={item?.priority || "medium"}
                  >
                    <option value="low">Low · whenever there’s room</option>
                    <option value="medium">Medium · keep in view</option>
                    <option value="high">High · make it a focus</option>
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={item?.status || "todo"}>
                    <option value="todo">To do</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
              </div>
              <label>
                Due date <span className="label-meta">optional</span>
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
                What’s worth remembering?
                <textarea
                  name="content"
                  autoFocus
                  rows={4}
                  defaultValue={item?.content || ""}
                  placeholder="e.g. I do my best focused work in the morning."
                  required
                  maxLength={10000}
                />
              </label>
              <label>
                Category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="fact">Important fact</option>
                  <option value="preference">Preference</option>
                  <option value="goal">Long-term goal</option>
                  <option value="task_context">Task context</option>
                </select>
              </label>
              <label className="checkbox-label consent-box">
                <input
                  name="confirmed"
                  type="checkbox"
                  defaultChecked={item?.status === "confirmed"}
                />
                <span>
                  <strong>I want my assistant to remember this.</strong>
                  <small>
                    Unchecked memories are saved for review and are not used as
                    long-term context.
                  </small>
                </span>
              </label>
              {item?.source && (
                <div className="field-note">
                  <FileText size={13} /> Source: {item.source}
                </div>
              )}
            </>
          )}
          {kind === "calendar" && (
            <>
              <div className="form-grid">
                <label>
                  Starts
                  <input
                    name="start_at"
                    type="datetime-local"
                    required
                    defaultValue={inputDate(item?.start_at)}
                  />
                </label>
                <label>
                  Ends
                  <input
                    name="end_at"
                    type="datetime-local"
                    required
                    defaultValue={inputDate(item?.end_at)}
                  />
                </label>
              </div>
              <label>
                Calendar
                <select
                  name="provider"
                  defaultValue={item?.provider || "local"}
                >
                  <option value="local">PersonalOS · local workspace</option>
                  <option value="google">
                    Google Calendar · approval required
                  </option>
                </select>
              </label>
              <div className="field-note">
                <CalendarDays size={14} /> Scheduling conflicts are checked
                before the event is saved.
              </div>
            </>
          )}
          {kind === "automations" && (
            <>
              <label>
                Routine type
                <select
                  name="automation_kind"
                  value={automationKind}
                  onChange={(event) => setAutomationKind(event.target.value)}
                >
                  <option value="agent">AI assistant task</option>
                  <option value="briefing">Daily briefing</option>
                </select>
              </label>
              {automationKind === "briefing" && (
                <div className="field-note">
                  <FileText size={13} /> Generates and saves a briefing from
                  your real tasks, calendar and confirmed memories.
                </div>
              )}
              <label>
                {automationKind === "briefing"
                  ? "Routine note"
                  : "What should your assistant do?"}
                <textarea
                  name="prompt"
                  rows={3}
                  required
                  defaultValue={item?.prompt || ""}
                  placeholder="e.g. Give me a concise briefing of today's tasks, events and priorities."
                />
              </label>
              <div className="form-grid">
                <label>
                  Schedule (cron)
                  <input
                    name="cron"
                    defaultValue={item?.cron || "0 8 * * *"}
                    placeholder="0 8 * * *"
                  />
                </label>
                <label>
                  Time zone
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
                <Clock3 size={13} /> “0 8 * * *” runs daily at 08:00. Leave
                blank for a one-time run.
              </div>
              <div className="form-grid">
                <label>
                  One-time / next execution
                  <input
                    name="next_run_at"
                    type="datetime-local"
                    defaultValue={inputDate(item?.next_run_at)}
                  />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={item?.status || "active"}>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {kind === "integrations" && (
            <>
              <label>
                HTTPS server URL
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
                  New servers start untrusted with no permissions. You’ll review
                  tools and explicitly authorize access after adding the server.
                </p>
              </div>
            </>
          )}
          <ErrorText text={action.error} />
          <div className="modal-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.pending}>
              {action.pending ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              {item ? "Save changes" : `Add ${titles[kind]}`}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
