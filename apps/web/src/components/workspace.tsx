"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  AudioLines,
  Bot,
  Brain,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Compass,
  Feather,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Network,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  Zap,
  ListTodo,
  Activity,
} from "lucide-react";
import { api, ApiError, type Settings, type User } from "@/lib/api";
import {
  AIConfigurationContext,
  AISetupNotice,
} from "@/components/ai-configuration";
import { Button } from "@/components/ui/button";
import {
  ActivityPage,
  AutomationsPage,
  CalendarPage,
  ChatPage,
  DashboardPage,
  IntegrationsPage,
  MemoryPage,
  SettingsPage,
  TasksPage,
} from "@/components/workspace-pages";
const navigation = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "chat", label: "AI assistant", icon: MessageSquare },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "automations", label: "Automations", icon: Zap },
  { id: "integrations", label: "Connections", icon: Network },
  { id: "activity", label: "Activity & approvals", icon: Activity },
];
export function Workspace({ section }: { section: string }) {
  const client = useQueryClient();
  const user = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    retry: false,
  });
  const configuration = useQuery({
    queryKey: ["settings", user.data?.id],
    queryFn: () => api<Settings>("/settings"),
    enabled: !!user.data && !user.error,
    retry: false,
  });
  useEffect(() => {
    if (
      configuration.error instanceof ApiError &&
      configuration.error.status === 401
    )
      void client.invalidateQueries({ queryKey: ["me"] });
  }, [configuration.error, client]);
  const [dark, setDark] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("personalos-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const [mobile, setMobile] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState("");
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("personalos-theme", next ? "dark" : "light");
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    client.clear();
    await user.refetch();
  }
  async function signedIn() {
    // Login may follow an expired session: never retain another account's data.
    await client.cancelQueries();
    client.clear();
    const result = await user.refetch();
    if (!result.data) return;
    try {
      await client.fetchQuery({
        queryKey: ["settings", result.data.id],
        queryFn: () => api<Settings>("/settings"),
        retry: false,
      });
    } catch {
      // The authenticated workspace shows a retryable configuration error.
    }
  }
  if (user.isPending)
    return (
      <div className="boot">
        <span className="brand-mark">
          <Command size={22} />
        </span>
        <p>Making a little headspace…</p>
        <span className="loading-line" />
      </div>
    );
  if (user.error)
    return (
      <AuthScreen
        error={
          user.error instanceof ApiError && user.error.status === 401
            ? undefined
            : user.error.message
        }
        onDone={signedIn}
      />
    );
  const me = user.data;
  return (
    <AIConfigurationContext.Provider value={configuration}>
      <div className="app-shell">
        <aside className={`sidebar ${mobile ? "open" : ""}`}>
          <Link className="brand" href="/dashboard">
            <span className="brand-mark">
              <Command size={21} strokeWidth={2.2} />
            </span>
            <span>
              Personal<span className="brand-os">OS</span>
              <small>A little more headspace.</small>
            </span>
          </Link>
          <div className="workspace-picker">
            <span className="workspace-avatar">
              {(me.name || me.email)[0].toUpperCase()}
            </span>
            <span>
              My workspace<small>Personal space</small>
            </span>
            <ChevronDown size={15} />
          </div>
          <div className="nav-caption">YOUR WORKSPACE</div>
          <nav>
            {navigation.map(({ id, label, icon: Icon }, i) => (
              <Link
                key={id}
                href={`/${id}`}
                onClick={() => setMobile(false)}
                className={`nav-item ${section === id ? "active" : ""}`}
                aria-current={section === id ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {i === 1 && <span className="nav-new">AI</span>}
                {section === id && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-note">
              <ShieldCheck size={19} />
              <strong>Yours, by design.</strong>
              <p>You choose what your AI remembers and what it can do.</p>
              <Link href="/settings">
                Privacy & control <ArrowUpRight size={13} />
              </Link>
            </div>
            <Link
              className={`nav-item ${section === "settings" ? "active" : ""}`}
              href="/settings"
            >
              <Settings2 size={18} />
              <span>Settings</span>
            </Link>
            <button className="nav-item" onClick={() => setHelp(!help)}>
              <CircleHelp size={18} />
              <span>How it works</span>
            </button>
            <button
              className="profile"
              onClick={() => {
                void logout();
              }}
              aria-label="Sign out"
            >
              <span className="user-avatar">
                {(me.name || me.email)[0].toUpperCase()}
              </span>
              <span>
                {me.name || me.email.split("@")[0]}
                <small>Personal account</small>
              </span>
              <LogOut size={15} />
            </button>
          </div>
        </aside>
        {mobile && (
          <button
            className="mobile-overlay"
            aria-label="Close menu"
            onClick={() => setMobile(false)}
          />
        )}
        <div className="workspace-main">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="Open menu"
                onClick={() => setMobile(!mobile)}
              >
                <Menu size={21} />
              </button>
              <span>My workspace</span>
              <span className="breadcrumb-slash">/</span>
              <strong>
                {section === "settings"
                  ? "Settings"
                  : navigation.find((n) => n.id === section)?.label}
              </strong>
            </div>
            <div className="topbar-actions">
              <form action="/memory" className="global-search">
                <Search size={15} />
                <input
                  name="q"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your memory…"
                  aria-label="Search your memory"
                />
                <kbd>↵</kbd>
              </form>
              <button
                className="icon-button"
                onClick={toggleTheme}
                aria-label={dark ? "Use light theme" : "Use dark theme"}
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <span className="topbar-divider" />
              <Link className="assistant-shortcut" href="/chat">
                <Sparkles size={15} /> Ask PersonalOS <span>↗</span>
              </Link>
            </div>
          </header>
          <main className="page-content">
            {section !== "settings" && <AISetupNotice />}
            {section === "dashboard" && <DashboardPage user={me} />}
            {section === "chat" && <ChatPage />}
            {section === "memory" && <MemoryPage />}
            {section === "tasks" && <TasksPage />}
            {section === "calendar" && <CalendarPage />}
            {section === "automations" && <AutomationsPage />}
            {section === "integrations" && <IntegrationsPage />}
            {section === "activity" && <ActivityPage />}
            {section === "settings" && <SettingsPage user={me} />}
          </main>
          <footer className="workspace-footer">
            <span>
              <span className="tiny-dot" /> PRIVATE WORKSPACE
            </span>
            <span>
              Less busywork. More room for you. <Feather size={12} />
            </span>
          </footer>
        </div>
        {help && (
          <div className="modal-overlay" onClick={() => setHelp(false)}>
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-heading"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-head">
                <h2 id="help-heading">A thoughtful second brain.</h2>
                <button
                  className="icon-button"
                  aria-label="Close"
                  onClick={() => setHelp(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <p>
                PersonalOS brings your tasks, calendar, memories and automations
                into one private workspace.
              </p>
              <div className="help-step">
                <Brain size={22} />
                <div>
                  <strong>Memory you control</strong>
                  <p>
                    Review suggestions before they become long-term memories.
                    Edit, export or delete them whenever you like.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <Bot size={22} />
                <div>
                  <strong>Actions with your permission</strong>
                  <p>
                    External changes wait for approval. Review their exact
                    parameters in Activity & approvals.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <Network size={22} />
                <div>
                  <strong>Connect on your terms</strong>
                  <p>
                    Configure a model and authorize a calendar or trusted MCP
                    server to enable connected capabilities.
                  </p>
                </div>
              </div>
              <Button onClick={() => setHelp(false)}>
                Got it <Check size={16} />
              </Button>
            </section>
          </div>
        )}
      </div>
    </AIConfigurationContext.Provider>
  );
}
function AuthScreen({
  error,
  onDone,
}: {
  error?: string;
  onDone: () => Promise<void>;
}) {
  const [register, setRegister] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    const data = new FormData(event.currentTarget);
    try {
      await api(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          name: data.get("name") || undefined,
        }),
      });
      await onDone();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">
            <Command size={22} />
          </span>
          <span>PersonalOS</span>
        </Link>
        <div className="auth-editorial">
          <span className="eyebrow">YOUR LIFE. A LITTLE LIGHTER.</span>
          <h1>
            Make room
            <br />
            for what
            <br />
            <em>matters.</em>
          </h1>
          <p>
            A private, thoughtful AI workspace.
            <br />
            For your plans, your ideas, and everything in between.
          </p>
          <div className="auth-orbit">
            <Compass size={94} strokeWidth={0.7} />
            <span />
            <i />
          </div>
        </div>
        <small>
          <ShieldCheck size={14} /> Your memories. Your permissions. Your
          control.
        </small>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <span className="eyebrow">
            <AudioLines size={15} /> A LITTLE MORE HEADSPACE
          </span>
          <h2>{register ? "Your space starts here." : "Welcome back."}</h2>
          <p>
            {register
              ? "Create your private PersonalOS account."
              : "A fresh perspective on the day ahead."}
          </p>
          <form
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            {register && (
              <label>
                Your name
                <input
                  name="name"
                  placeholder="What should we call you?"
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                placeholder={
                  register ? "At least 12 characters" : "Your password"
                }
                minLength={register ? 12 : 1}
                autoComplete={register ? "new-password" : "current-password"}
                required
              />
            </label>
            {(failure || error) && (
              <div className="error-banner" role="alert">
                {failure || error}
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {pending
                ? "One moment…"
                : register
                  ? "Create your workspace"
                  : "Enter your workspace"}
              <ArrowUpRight size={17} />
            </Button>
          </form>
          <div className="auth-switch">
            {register ? "Already have a space?" : "New to PersonalOS?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setFailure(undefined);
              }}
            >
              {register ? "Sign in" : "Create an account"}
            </button>
          </div>
          <div className="auth-detail">
            <ShieldCheck size={16} />
            <p>
              Nothing is remembered without your say.
              <br />
              Connected actions always respect your permissions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
