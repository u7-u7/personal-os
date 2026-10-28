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
  const configuration = useAIConfiguration();
  if (configuration.isPending)
    return (
      <div className="ai-configuration-status" role="status">
        <LoaderCircle size={15} className="spin" /> 正在读取你的 AI 配置…
      </div>
    );
  if (configuration.error)
    return (
      <div className="error-banner" role="alert">
        <span>
          无法读取 AI 配置，AI 功能暂不可用。{configuration.error.message}
        </span>
        <button onClick={() => void configuration.refetch()}>
          重新读取 <RefreshCw size={13} />
        </button>
      </div>
    );
  const settings = configuration.data;
  if (!settings || (!full && settings.ai_setup_complete)) return null;
  const steps = [
    {
      id: "chat-configuration",
      title: "聊天模型",
      detail: "Model ID · Base URL · API Key",
      ready: settings.chat_configured,
      icon: Bot,
    },
    {
      id: "embedding-configuration",
      title: "向量模型",
      detail: "北京工作空间 Base URL · 独立 API Key",
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
        <span className="eyebrow">YOUR AI, CONNECTED BY YOU</span>
        <h2 id="ai-setup-heading">
          {settings.ai_setup_complete
            ? "AI 配置已填写"
            : "连接你的 AI，先完成这两步"}
        </h2>
        <p>
          聊天和 AI
          简报需要聊天模型；向量模型用于记忆检索。任务、日历和手动记忆管理可直接使用。
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
                <span>{ready ? "已填写" : "待配置"}</span>
              </strong>
              <small>{detail}</small>
            </div>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      </div>
      {full && (
        <p className="ai-setup-footnote">
          可以分步保存。保存仅代表配置已存储；请分别点击「测试已保存连接」验证真实可用性。向量模型配置不会自动开启
          Hy-Memory 索引。
        </p>
      )}
    </section>
  );
}
