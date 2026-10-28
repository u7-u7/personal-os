"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Database,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { api, type EmbeddingConnectionCheck, type Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function EmbeddingSettings({
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
  const keyInput = useRef<HTMLInputElement>(null);
  const check = useMutation({
    mutationFn: async (version: number) => ({
      ...(await api<EmbeddingConnectionCheck>("/settings/embedding/test", {
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

  async function testConnection() {
    onTestPendingChange(true);
    try {
      await check.mutateAsync(settings.version);
    } catch {
      // TanStack retains the API error below; a rejected probe is never a success.
    } finally {
      onTestPendingChange(false);
    }
  }

  async function removeKey() {
    if (
      !confirm(
        "Remove the embedding API key? Future embedding calls will become unavailable.",
      )
    )
      return;
    check.reset();
    if (await onRemoveKey()) {
      if (keyInput.current) keyInput.current.value = "";
    }
  }

  return (
    <section
      className="panel settings-section"
      id="embedding-configuration"
      aria-labelledby="embedding-heading"
    >
      <div className="settings-section-heading">
        <span className="small-icon">
          <Database size={21} />
        </span>
        <div>
          <h2 id="embedding-heading">2. 向量模型 · Your embedding model</h2>
          <p>
            Qwen3.7 Embedding Flash
            将文字转换为记忆检索向量，使用中国内地（北京）百炼工作空间的独立地址与
            API Key。尚未配置不会阻止聊天。
          </p>
        </div>
      </div>
      <fieldset
        className="embedding-fields"
        disabled={disabled}
        onChange={() => {
          check.reset();
          onChange();
        }}
      >
        <div className="form-grid">
          <label>
            Embedding model ID <span className="label-meta">向量模型</span>
            <input
              aria-label="Embedding model ID"
              name="embedding_model"
              value="qwen3.7-text-embedding-flash"
              readOnly
            />
          </label>
          <label>
            Vector dimensions <span className="label-meta">向量维度</span>
            <select
              aria-label="Vector dimensions"
              name="embedding_dimensions"
              defaultValue={String(settings.embedding_dimensions || 1024)}
            >
              <option value="1024">1024 · default</option>
              <option value="768">768</option>
              <option value="512">512</option>
              <option value="256">256</option>
            </select>
          </label>
        </div>
        <label>
          Beijing workspace base URL{" "}
          <span className="label-meta">北京工作空间地址 · 首次配置必填</span>
          <input
            aria-label="Beijing workspace base URL"
            name="embedding_base_url"
            type="url"
            defaultValue={settings.embedding_base_url || ""}
            placeholder="https://YOUR-WORKSPACE-ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
            autoComplete="off"
          />
        </label>
        <div className="field-note">
          从你的百炼北京工作空间复制 OpenAI 兼容 Base URL，需包含真实工作空间
          ID；不会自动使用聊天模型的地址。
        </div>
        <label>
          Embedding API key{" "}
          <span className="label-meta">
            {settings.embedding_api_key_configured
              ? "独立密钥已配置，留空保留"
              : "首次配置必填"}
          </span>
          <input
            ref={keyInput}
            name="embedding_api_key"
            type="password"
            autoComplete="new-password"
            aria-required={!settings.embedding_api_key_configured}
            placeholder={
              settings.embedding_api_key_configured
                ? "留空保留当前向量模型密钥"
                : "填写百炼北京工作空间 API Key"
            }
          />
        </label>
        <div className="field-note">
          <LockKeyhole size={13} />{" "}
          密钥仅在服务端加密保存，不会返回浏览器。DeepSeek
          密钥不会用于向量模型。
        </div>
      </fieldset>
      <div className="provider-presets">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Test saved embedding connection"
          disabled={disabled}
          onClick={() => void testConnection()}
        >
          {check.isPending ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <FlaskConical size={14} />
          )}
          测试已保存连接 · Embedding
        </Button>
        {settings.embedding_api_key_configured && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void removeKey()}
          >
            Remove embedding key
          </Button>
        )}
      </div>
      <div className="field-note">
        先保存再测试。检测仅发送固定文本，不会上传你的记忆；可能产生少量供应商费用。
      </div>
      {currentCheck && check.error && (
        <div className="error-banner" role="alert">
          {check.error instanceof Error
            ? check.error.message
            : "Embedding connection check failed"}
        </div>
      )}
      {serverSettingsChanged && (
        <div className="error-banner" role="alert">
          Saved embedding settings changed on the server. Refresh this page and
          test again.
        </div>
      )}
      {currentCheck && check.data && !serverSettingsChanged && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={16} /> The saved endpoint returned a valid{" "}
          {check.data.dimensions}-dimension embedding from {check.data.model}.
        </div>
      )}
      <div className="field-note">
        <ShieldCheck size={13} /> Saving or testing this configuration does not
        enable Hy Memory indexing. Its data storage and authorization still need
        separate setup.
      </div>
    </section>
  );
}
