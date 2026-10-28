"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { api, type ChatConnectionCheck, type Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function ChatSettings({
  settings,
  pending,
  onChange,
  onRemoveKey,
  onTestPendingChange,
}: {
  settings: Settings;
  pending: boolean;
  onChange: () => void;
  onRemoveKey: () => Promise<boolean>;
  onTestPendingChange: (pending: boolean) => void;
}) {
  const fields = useRef<HTMLFieldSetElement>(null);
  const check = useMutation({
    mutationFn: async (version: number) => ({
      ...(await api<ChatConnectionCheck>("/settings/chat/test", {
        method: "POST",
        body: "{}",
      })),
      settingsVersion: version,
    }),
  });
  const currentCheck = check.variables === settings.version;
  const serverSettingsChanged =
    check.data && check.data.settings_version !== settings.version;
  const disabled = pending || check.isPending;
  function changed() {
    check.reset();
    onChange();
  }
  async function testConnection() {
    onTestPendingChange(true);
    try {
      await check.mutateAsync(settings.version);
    } catch {
      /* Failed probes are displayed below and never treated as success. */
    } finally {
      onTestPendingChange(false);
    }
  }
  return (
    <section
      className="panel settings-section"
      id="chat-configuration"
      aria-labelledby="chat-configuration-heading"
    >
      <div className="settings-section-heading">
        <span className="small-icon">
          <Bot size={21} />
        </span>
        <div>
          <h2 id="chat-configuration-heading">1. 聊天模型 · Your AI model</h2>
          <p>
            填写 OpenAI 兼容服务的模型、地址和密钥，用于对话、任务理解和每日 AI
            简报。
          </p>
        </div>
      </div>
      <fieldset
        ref={fields}
        className="embedding-fields"
        disabled={disabled}
        onChange={changed}
      >
        <div className="provider-presets">
          <span>Quick setup</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              const form = fields.current?.form;
              if (!form) return;
              const preset = {
                model: "deepseek-flash",
                base_url: "https://api.deepseek.com",
                fast_model: "deepseek-flash",
                reasoning_model: "deepseek-v4-pro",
              };
              for (const [name, value] of Object.entries(preset)) {
                const input = form.elements.namedItem(name);
                if (input instanceof HTMLInputElement) input.value = value;
              }
              changed();
            }}
          >
            DeepSeek <ArrowUpRight size={13} />
          </Button>
          <span className="field-note">仅填写预设，补充 Key 后保存。</span>
        </div>
        <div className="form-grid">
          <label>
            Model ID <span className="label-meta">聊天模型名称 · 必填</span>
            <input
              aria-label="Model ID"
              name="model"
              defaultValue={settings.model || ""}
              placeholder="供应商提供的模型 ID"
              required
            />
          </label>
          <label>
            Provider base URL{" "}
            <span className="label-meta">聊天 API 地址 · 必填</span>
            <input
              aria-label="Provider base URL"
              name="base_url"
              type="url"
              defaultValue={settings.base_url || ""}
              placeholder="https://api.deepseek.com"
              required
              autoComplete="off"
            />
          </label>
        </div>
        <label>
          API key{" "}
          <span className="label-meta">
            {settings.api_key_configured
              ? "密钥已配置，留空保留"
              : "首次配置必填"}
          </span>
          <input
            name="api_key"
            type="password"
            autoComplete="new-password"
            aria-required={!settings.api_key_configured}
            placeholder={
              settings.api_key_configured
                ? "留空保留当前密钥"
                : "填写聊天模型供应商的 API Key"
            }
          />
        </label>
        <div className="field-note">
          <LockKeyhole size={13} /> 密钥仅在服务端加密保存，不会返回浏览器。
          {settings.chat_config_source === "server_default"
            ? "当前使用服务端默认模型配置。"
            : settings.chat_config_source === "personal"
              ? "当前使用你的个人配置。"
              : "尚未配置可用的聊天连接。"}
        </div>
        <div className="form-grid">
          <label>
            Fast routing model <span className="label-meta">optional</span>
            <input
              aria-label="Fast routing model"
              name="fast_model"
              defaultValue={settings.fast_model || ""}
              placeholder="留空使用主模型"
            />
          </label>
          <label>
            Reasoning routing model <span className="label-meta">optional</span>
            <input
              aria-label="Reasoning routing model"
              name="reasoning_model"
              defaultValue={settings.reasoning_model || ""}
              placeholder="留空使用主模型"
            />
          </label>
        </div>
        <label>
          How to route requests
          <select
            name="decision_provider"
            defaultValue={settings.decision_provider || "rules"}
          >
            <option value="rules">Fast rules · default</option>
            <option value="llm">Your language model</option>
            <option value="jev">Jev · requires server authorization</option>
          </select>
        </label>
        <div className="field-note">
          <ShieldCheck size={13} /> 路由只选择模型；敏感操作仍需要你的审批。
        </div>
      </fieldset>
      <div className="provider-presets">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => void testConnection()}
        >
          {check.isPending ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <FlaskConical size={14} />
          )}
          测试已保存连接 · Chat
        </Button>
        {settings.api_key_configured && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (!confirm("移除聊天模型 API Key？聊天和 AI 简报将不可用。"))
                return;
              check.reset();
              void onRemoveKey().then((ok) => {
                const input =
                  fields.current?.form?.elements.namedItem("api_key");
                if (ok && input instanceof HTMLInputElement) input.value = "";
              });
            }}
          >
            移除聊天密钥
          </Button>
        )}
      </div>
      <div className="field-note">
        先保存再测试。检测会向已保存的模型发送固定短消息，可能产生少量供应商费用，不会发送你的对话或记忆。
      </div>
      {currentCheck && check.error && (
        <div className="error-banner" role="alert">
          {check.error.message}
        </div>
      )}
      {serverSettingsChanged && (
        <div className="error-banner" role="alert">
          服务端配置已变更，请重新读取设置后再测试。
        </div>
      )}
      {currentCheck && check.data && !serverSettingsChanged && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={16} /> 已保存的 {check.data.model}{" "}
          返回真实回复，聊天连接验证通过。
        </div>
      )}
    </section>
  );
}
