"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { useI18n, LanguageSelector } from "@/components/i18n-provider";
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

const AUTH_CHANGE_CHANNEL = "personalos-auth";
const AUTH_CHANGE_STORAGE_KEY = "personalos-auth-change";
// This is only message correlation, never a credential or permission token.
const AUTH_TAB_ID = typeof window === "undefined" ? "" : `${Date.now()}-${Math.random()}`;
const AUTH_CACHE_OWNER_KEY = ["auth-cache-owner"];
function announceAuthChange() {
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(AUTH_CHANGE_CHANNEL);
      channel.postMessage({ type: "changed", source: AUTH_TAB_ID });
      channel.close();
      return;
    } catch {
      // Some private browser policies deny channels; storage is the fallback.
    }
  }
  try {
    // Broadcast only a nonce, never an account identifier or session token.
    localStorage.setItem(AUTH_CHANGE_STORAGE_KEY, crypto.randomUUID());
  } catch {
    // Focus refetch still checks the session when browser messaging is denied.
  }
}
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
  const { t } = useI18n();
  const client = useQueryClient();
  const user = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const { refetch: refetchUser } = user;
  const [authRefreshing, setAuthRefreshing] = useState(false);
  const observedOwner = user.error ? undefined : user.data?.id;
  const [cacheOwner, setCacheOwner] = useState<string | undefined>(
    () => client.getQueryData<string>(AUTH_CACHE_OWNER_KEY) || observedOwner,
  );
  const [identityMismatch, setIdentityMismatch] = useState(false);
  const refreshIdentityRef = useRef<(() => void) | null>(null);
  // Hide the previous subtree before committing a new identity's header. A
  // focus refetch can discover a cookie change even when no broadcast arrived.
  if (observedOwner && observedOwner !== cacheOwner && !authRefreshing) {
    if (!cacheOwner) setCacheOwner(observedOwner);
    else if (!identityMismatch) setIdentityMismatch(true);
  }
  useEffect(() => {
    let active = true;
    let running = false;
    let changedAgain = false;
    async function refreshIdentity() {
      if (!active) return;
      changedAgain = true;
      if (running) return;
      running = true;
      setAuthRefreshing(true);
      try {
        do {
          changedAgain = false;
          await client.cancelQueries();
          if (!active) return;
          client.clear();
          const result = await refetchUser();
          if (!active) return;
          if (!changedAgain) {
            setCacheOwner(result.error ? undefined : result.data?.id);
            setIdentityMismatch(false);
          }
        } while (active && changedAgain);
      } finally {
        running = false;
        if (active) setAuthRefreshing(false);
      }
    }
    const receive = () => void refreshIdentity();
    refreshIdentityRef.current = receive;
    const storageChanged = (event: StorageEvent) => {
      if (event.key === AUTH_CHANGE_STORAGE_KEY) receive();
    };
    let channel: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(AUTH_CHANGE_CHANNEL);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (
            message === "changed" ||
            (typeof message === "object" &&
              message !== null &&
              "type" in message &&
              message.type === "changed" &&
              "source" in message &&
              message.source !== AUTH_TAB_ID)
          )
            receive();
        };
      }
    } catch {
      // The storage listener below also handles unavailable channel support.
    }
    window.addEventListener("storage", storageChanged);
    return () => {
      active = false;
      if (refreshIdentityRef.current === receive)
        refreshIdentityRef.current = null;
      channel?.close();
      window.removeEventListener("storage", storageChanged);
    };
  }, [client, refetchUser]);
  useEffect(() => {
    if (identityMismatch) refreshIdentityRef.current?.();
  }, [identityMismatch]);
  useEffect(() => {
    if (
      cacheOwner &&
      observedOwner === cacheOwner &&
      !authRefreshing &&
      !identityMismatch
    ) {
      // This marker describes all owner-less query keys, including ones still
      // observed on another route. Retain it until the same cache is cleared.
      client.setQueryDefaults(AUTH_CACHE_OWNER_KEY, { gcTime: Infinity });
      client.setQueryData(AUTH_CACHE_OWNER_KEY, cacheOwner);
    }
  }, [client, cacheOwner, observedOwner, authRefreshing, identityMismatch]);
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
    announceAuthChange();
    client.clear();
    await user.refetch();
  }
  async function signedIn() {
    announceAuthChange();
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
  if (user.isPending || authRefreshing || identityMismatch)
    return (
      <div className="boot">
        <span className="brand-mark">
          <Command size={22} />
        </span>
        <p>{t("Making a little headspace\u2026")}</p>
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
              <small>{t("A little more headspace.")}</small>
            </span>
          </Link>
          <div className="workspace-picker">
            <span className="workspace-avatar">
              {(me.name || me.email)[0].toUpperCase()}
            </span>
            <span>
              {t("My workspace")}
              <small>{t("Personal space")}</small>
            </span>
            <ChevronDown size={15} />
          </div>
          <div className="nav-caption">{t("YOUR WORKSPACE")}</div>
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
                <span>{t(label)}</span>
                {i === 1 && <span className="nav-new">AI</span>}
                {section === id && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-note">
              <ShieldCheck size={19} />
              <strong>{t("Yours, by design.")}</strong>
              <p>
                {t("You choose what your AI remembers and what it can do.")}
              </p>
              <Link href="/settings">
                {t("Privacy & control")}
                <ArrowUpRight size={13} />
              </Link>
            </div>
            <Link
              className={`nav-item ${section === "settings" ? "active" : ""}`}
              href="/settings"
            >
              <Settings2 size={18} />
              <span>{t("Settings")}</span>
            </Link>
            <button className="nav-item" onClick={() => setHelp(!help)}>
              <CircleHelp size={18} />
              <span>{t("How it works")}</span>
            </button>
            <button
              className="profile"
              onClick={() => {
                void logout();
              }}
              aria-label={t("Sign out")}
            >
              <span className="user-avatar">
                {(me.name || me.email)[0].toUpperCase()}
              </span>
              <span>
                {me.name || me.email.split("@")[0]}
                <small>{t("Personal account")}</small>
              </span>
              <LogOut size={15} />
            </button>
          </div>
        </aside>
        {mobile && (
          <button
            className="mobile-overlay"
            aria-label={t("Close menu")}
            onClick={() => setMobile(false)}
          />
        )}
        <div className="workspace-main">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label={t("Open menu")}
                onClick={() => setMobile(!mobile)}
              >
                <Menu size={21} />
              </button>
              <span>{t("My workspace")}</span>
              <span className="breadcrumb-slash">/</span>
              <strong>
                {t(
                  section === "settings"
                    ? "Settings"
                    : navigation.find((n) => n.id === section)?.label || "",
                )}
              </strong>
            </div>
            <div className="topbar-actions">
              <form action="/memory" className="global-search">
                <Search size={15} />
                <input
                  name="q"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Search your memory\u2026")}
                  aria-label={t("Search your memory")}
                />
                <kbd>↵</kbd>
              </form>
              <button
                className="icon-button"
                onClick={toggleTheme}
                aria-label={dark ? t("Use light theme") : t("Use dark theme")}
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <span className="topbar-divider" />
              <Link className="assistant-shortcut" href="/chat">
                <Sparkles size={15} />
                {t("Ask PersonalOS")}
                <span>↗</span>
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
              <span className="tiny-dot" />
              {t("PRIVATE WORKSPACE")}
            </span>
            <span>
              {t("Less busywork. More room for you.")}
              <Feather size={12} />
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
                <h2 id="help-heading">{t("A thoughtful second brain.")}</h2>
                <button
                  className="icon-button"
                  aria-label={t("Close")}
                  onClick={() => setHelp(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <p>
                {t(
                  "PersonalOS brings your tasks, calendar, memories and automations into one private workspace.",
                )}
              </p>
              <div className="help-step">
                <Brain size={22} />
                <div>
                  <strong>{t("Memory you control")}</strong>
                  <p>
                    {t(
                      "Review suggestions before they become long-term memories. Edit, export or delete them whenever you like.",
                    )}
                  </p>
                </div>
              </div>
              <div className="help-step">
                <Bot size={22} />
                <div>
                  <strong>{t("Actions with your permission")}</strong>
                  <p>
                    {t(
                      "External changes wait for approval. Review their exact parameters in Activity & approvals.",
                    )}
                  </p>
                </div>
              </div>
              <div className="help-step">
                <Network size={22} />
                <div>
                  <strong>{t("Connect on your terms")}</strong>
                  <p>
                    {t(
                      "Configure a model and authorize a calendar or trusted MCP server to enable connected capabilities.",
                    )}
                  </p>
                </div>
              </div>
              <Button onClick={() => setHelp(false)}>
                {t("Got it")}
                <Check size={16} />
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
  const { t, errorText } = useI18n();
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
      setFailure(err instanceof Error ? err.message : t("Could not sign in"));
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
          <span className="eyebrow">{t("YOUR LIFE. A LITTLE LIGHTER.")}</span>
          <h1>
            {t("Make room")}
            <br />
            {t("for what")}
            <br />
            <em>{t("matters.")}</em>
          </h1>
          <p>
            {t("A private, thoughtful AI workspace.")}
            <br />
            {t("For your plans, your ideas, and everything in between.")}
          </p>
          <div className="auth-orbit">
            <Compass size={94} strokeWidth={0.7} />
            <span />
            <i />
          </div>
        </div>
        <small>
          <ShieldCheck size={14} />
          {t("Your memories. Your permissions. Your control.")}
        </small>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <LanguageSelector className="auth-language-selector" />
          <span className="eyebrow">
            <AudioLines size={15} />
            {t("A LITTLE MORE HEADSPACE")}
          </span>
          <h2>
            {register ? t("Your space starts here.") : t("Welcome back.")}
          </h2>
          <p>
            {register
              ? t("Create your private PersonalOS account.")
              : t("A fresh perspective on the day ahead.")}
          </p>
          <form
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            {register && (
              <label>
                {t("Your name")}
                <input
                  name="name"
                  placeholder={t("What should we call you?")}
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label>
              {t("Email address")}
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <label>
              {t("Password")}
              <input
                type="password"
                name="password"
                placeholder={
                  register ? t("At least 8 characters") : t("Your password")
                }
                minLength={register ? 8 : 1}
                autoComplete={register ? "new-password" : "current-password"}
                required
              />
            </label>
            {(failure || error) && (
              <div className="error-banner" role="alert">
                {errorText(failure || error || "")}
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {pending
                ? t("One moment\u2026")
                : register
                  ? t("Create your workspace")
                  : t("Enter your workspace")}
              <ArrowUpRight size={17} />
            </Button>
          </form>
          <div className="auth-switch">
            {register ? t("Already have a space?") : t("New to PersonalOS?")}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setFailure(undefined);
              }}
            >
              {register ? t("Sign in") : t("Create an account")}
            </button>
          </div>
          <div className="auth-detail">
            <ShieldCheck size={16} />
            <p>
              {t("Nothing is remembered without your say.")}
              <br />
              {t("Connected actions always respect your permissions.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
