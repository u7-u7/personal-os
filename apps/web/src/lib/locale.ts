import { workspaceMessages } from "@/lib/messages/workspace";
import { pageMessages } from "@/lib/messages/pages";
import { configurationMessages } from "@/lib/messages/configuration";

export type Locale = "en" | "zh-CN";
export type LanguagePreference = "system" | Locale;
export type TranslationValues = Record<string, string | number>;
export const LANGUAGE_COOKIE = "personalos-language";

export function languagePreference(value?: string): LanguagePreference {
  return value === "en" || value === "zh-CN" ? value : "system";
}

export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

export function acceptedLocale(header: string | null): Locale {
  // Respect q=0 exclusions and quality order on the first server render.
  const languages = (header || "")
    .split(",")
    .map((part) => {
      const [language, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      return {
        language,
        quality: quality ? Number(quality.trim().slice(2)) : 1,
      };
    })
    .filter((entry) => Number.isFinite(entry.quality) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return preferredLocale(languages.map((entry) => entry.language));
}

const messages: Record<string, string> = {
  ...workspaceMessages,
  ...pageMessages,
  ...configurationMessages,
};

export function translate(
  locale: Locale,
  message: string,
  values: TranslationValues = {},
): string {
  const translated =
    locale === "zh-CN" && Object.hasOwn(messages, message)
      ? messages[message]
      : message;
  return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}

export function translatedError(locale: Locale, message: string): string {
  if (message.includes("\n"))
    return message
      .split("\n")
      .map((line) => translatedError(locale, line))
      .join("\n");
  // Only known application diagnostics are translated. Provider/user text is
  // preserved verbatim instead of being run through a DOM or model translator.
  const short = message.match(/^String should have at least (\d+) characters$/);
  if (short)
    return translate(locale, "Use at least {count} characters.", {
      count: short[1],
    });
  const request = message.match(/^Request failed \((\d+)\)$/);
  if (request)
    return translate(locale, "Request failed ({status})", {
      status: request[1],
    });
  const provider = message.match(
    /^(Chat|Embedding) provider rejected the request \(HTTP (\d+)\); (.+)$/,
  );
  if (provider && locale === "zh-CN")
    return `${provider[1] === "Chat" ? "聊天" : "向量"}服务拒绝了请求（HTTP ${provider[2]}），请检查模型、工作空间权限和密钥`;
  return translate(locale, message);
}
