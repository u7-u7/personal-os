"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  Check,
  Database,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { Settings } from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

export const AIConfigurationContext = createContext<UseQueryResult<
  Settings,
  Error
> | null>(null);

export function useAIConfiguration() {
  const configuration = useContext(AIConfigurationContext);
  if (!configuration)
    throw new Error("AI configuration requires an authenticated workspace");
  return configuration;
}

export function AISetupNotice({ full = false }: { full?: boolean }) {
  const { t, errorText } = useI18n();
  const configuration = useAIConfiguration();
  if (configuration.isPending)
    return (
      <div className="ai-configuration-status" role="status">
        <LoaderCircle size={15} className="spin" />{" "}
        {t("Loading your AI settings…")}
      </div>
    );
  if (configuration.error)
    return (
      <div className="error-banner" role="alert">
        <span>
          {t(
            "Unable to load AI settings. AI features are temporarily unavailable. {error}",
            {
              error: errorText(configuration.error.message),
            },
          )}
        </span>
        <button onClick={() => void configuration.refetch()}>
          {t("Reload settings")} <RefreshCw size={13} />
        </button>
      </div>
    );
  const settings = configuration.data;
  if (!settings || (!full && settings.ai_setup_complete)) return null;
  const steps = [
    {
      id: "chat-configuration",
      title: t("Chat model"),
      detail: t("Model ID · Base URL · API Key"),
      ready: settings.chat_configured,
      icon: Bot,
    },
    {
      id: "embedding-configuration",
      title: t("Embedding model"),
      detail: t("Beijing Base URL · Separate API key"),
      ready: settings.embedding_configured,
      icon: Database,
    },
  ];
  return (
    <section
      className={`ai-setup-card ${full ? "ai-setup-full" : ""}`}
      aria-labelledby="ai-setup-heading"
    >
      <div className="ai-setup-intro">
        <span className="eyebrow">{t("YOUR AI, CONNECTED BY YOU")}</span>
        <h2 id="ai-setup-heading">
          {settings.ai_setup_complete
            ? t("AI configuration entered")
            : t("Connect your AI in two steps")}
        </h2>
        <p>
          {t(
            "Chat and AI briefings need a chat model; embeddings support memory retrieval. Tasks, calendar and manual memory management are ready to use.",
          )}
        </p>
      </div>
      <div className="ai-setup-steps">
        {steps.map(({ id, title, detail, ready, icon: Icon }, index) => (
          <Link
            key={id}
            href={`/settings?setup=1#${id}`}
            className={`ai-setup-step ${ready ? "ready" : ""}`}
          >
            <span className="ai-step-number">
              {ready ? <Check size={15} /> : index + 1}
            </span>
            <div>
              <strong>
                <Icon size={15} /> {title}
                <span>{ready ? t("Entered") : t("Not configured")}</span>
              </strong>
              <small>{detail}</small>
            </div>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      </div>
      {full && (
        <p className="ai-setup-footnote">
          {t(
            "Test the current fields, then save to apply them. Saving embedding settings does not enable Hy-Memory indexing.",
          )}
        </p>
      )}
    </section>
  );
}
