"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { dateLabel as formatDate, timeLabel as formatTime } from "@/lib/api";
import {
  LANGUAGE_COOKIE,
  languagePreference,
  preferredLocale,
  translate,
  translatedError,
  type LanguagePreference,
  type Locale,
  type TranslationValues,
} from "@/lib/locale";

const LANGUAGE_EVENT = "personalos-language-change";
function browserPreference(): LanguagePreference {
  const cookie = document.cookie
    .split(";")
    .find((part) => part.trim().startsWith(`${LANGUAGE_COOKIE}=`));
  return languagePreference(cookie?.trim().slice(LANGUAGE_COOKIE.length + 1));
}
function browserSnapshot() {
  const preference = browserPreference();
  const locale =
    preference === "system"
      ? preferredLocale(
          navigator.languages.length
            ? navigator.languages
            : [navigator.language],
        )
      : preference;
  return `${preference}:${locale}`;
}
function subscribe(onChange: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === LANGUAGE_COOKIE || event.key === null) onChange();
  };
  window.addEventListener("languagechange", onChange);
  window.addEventListener(LANGUAGE_EVENT, onChange);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener("languagechange", onChange);
    window.removeEventListener(LANGUAGE_EVENT, onChange);
    window.removeEventListener("storage", storageChanged);
  };
}

interface I18nContextValue {
  locale: Locale;
  language: LanguagePreference;
  setLanguage: (language: LanguagePreference) => void;
  t: (message: string, values?: TranslationValues) => string;
  errorText: (message: string) => string;
  dateLabel: (
    value?: string | null,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  timeLabel: (value?: string) => string;
}
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLanguage,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLanguage: LanguagePreference;
  initialLocale: Locale;
}) {
  const serverSnapshot = useCallback(
    () => `${initialLanguage}:${initialLocale}`,
    [initialLanguage, initialLocale],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    browserSnapshot,
    serverSnapshot,
  );
  const [preference, resolved] = snapshot.split(":");
  const language = languagePreference(preference);
  const locale: Locale = resolved === "zh-CN" ? "zh-CN" : "en";
  const setLanguage = useCallback((next: LanguagePreference) => {
    document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try {
      // Storage is only a cross-tab notification; the cookie is the preference
      // source for SSR and client rendering, even when localStorage is blocked.
      localStorage.setItem(LANGUAGE_COOKIE, next);
    } catch {
      // Private browser policies may deny storage; the current tab still works.
    }
    window.dispatchEvent(new Event(LANGUAGE_EVENT));
  }, []);
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      language,
      setLanguage,
      t: (message, values) => translate(locale, message, values),
      errorText: (message) => translatedError(locale, message),
      dateLabel: (value, options) => {
        if (!value) return translate(locale, "No date");
        return formatDate(value, options, locale);
      },
      timeLabel: (value) => formatTime(value, locale),
    }),
    [locale, language, setLanguage],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "PersonalOS — A little more headspace");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        translate(
          locale,
          "Your private AI workspace for a more intentional day. Tasks, memory, calendar and thoughtful automation.",
        ),
      );
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18nProvider is required");
  return context;
}

export function LanguageSelector({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className={`language-selector ${className}`}>
      <span>{t("Language")}</span>
      <select
        aria-label={t("Language")}
        value={language}
        onChange={(event) =>
          setLanguage(languagePreference(event.target.value))
        }
      >
        <option value="system">{t("Follow system")}</option>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
