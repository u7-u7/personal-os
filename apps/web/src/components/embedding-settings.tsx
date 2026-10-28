"use client";

import { useRef, useState } from "react";
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
import { useI18n } from "@/components/i18n-provider";

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
  const { t, errorText } = useI18n();
  const keyInput = useRef<HTMLInputElement>(null);
  const fields = useRef<HTMLFieldSetElement>(null);
  const [revision, setRevision] = useState(0);
  const [model, setModel] = useState(
    settings.embedding_model || "qwen3.7-text-embedding-flash",
  );
  const dimensions =
    model === "qwen3.7-text-embedding"
      ? [1024, 2560, 2048, 1536, 768, 512, 256]
      : [1024, 768, 512, 256];
  const locked = useRef(false);
  const check = useMutation({
    mutationFn: async (_identity: { version: number; revision: number }) => {
      const form = fields.current?.form;
      const value = (name: string) => {
        const input = form?.elements.namedItem(name);
        return input instanceof HTMLInputElement ||
          input instanceof HTMLSelectElement
          ? input.value.trim()
          : "";
      };
      const key = value("embedding_api_key");
      return api<EmbeddingConnectionCheck>("/settings/embedding/test", {
        method: "POST",
        body: JSON.stringify({
          version: _identity.version,
          embedding_model: value("embedding_model"),
          embedding_base_url: value("embedding_base_url"),
          embedding_dimensions: Number(value("embedding_dimensions")),
          ...(key ? { embedding_api_key: key } : {}),
        }),
      });
    },
  });
  const currentCheck =
    check.variables?.version === settings.version &&
    check.variables?.revision === revision;
  const serverSettingsChanged =
    check.data && check.data.settings_version !== settings.version;
  const disabled = pending || check.isPending;
  const testLabel =
    revision === 0
      ? t("Test saved embedding connection")
      : t("Test current embedding configuration");

  async function testConnection() {
    if (disabled || locked.current) return;
    locked.current = true;
    onTestPendingChange(true);
    try {
      await check.mutateAsync({ version: settings.version, revision });
    } catch {
      // TanStack retains the API error below; a rejected probe is never a success.
    } finally {
      locked.current = false;
      onTestPendingChange(false);
    }
  }

  async function removeKey() {
    if (
      !confirm(
        t(
          "Remove the embedding API key? Future embedding calls will become unavailable.",
        ),
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
          <h2 id="embedding-heading">{t("2. Your embedding model")}</h2>
          <p>
            {t(
              "Qwen3.7 Embedding turns text into memory retrieval vectors. Choose the standard or Flash model with an official Beijing endpoint and a separate embedding API key. Chat remains available without embeddings.",
            )}
          </p>
        </div>
      </div>
      <fieldset
        ref={fields}
        className="embedding-fields"
        disabled={disabled}
        onChange={() => {
          setRevision((value) => value + 1);
          check.reset();
          onChange();
        }}
      >
        <div className="form-grid">
          <label>
            {t("Embedding model ID")}{" "}
            <span className="label-meta">{t("Embedding model")}</span>
            <select
              aria-label={t("Embedding model ID")}
              name="embedding_model"
              value={model}
              onChange={(event) => {
                const nextModel = event.target.value;
                const dimension = fields.current?.form?.elements.namedItem(
                  "embedding_dimensions",
                );
                if (
                  nextModel === "qwen3.7-text-embedding-flash" &&
                  dimension instanceof HTMLSelectElement &&
                  ![1024, 768, 512, 256].includes(Number(dimension.value))
                ) {
                  dimension.value = "1024";
                }
                setModel(nextModel);
              }}
            >
              <option value="qwen3.7-text-embedding">
                qwen3.7-text-embedding
              </option>
              <option value="qwen3.7-text-embedding-flash">
                qwen3.7-text-embedding-flash
              </option>
            </select>
          </label>
          <label>
            {t("Vector dimensions")}
            <select
              aria-label={t("Vector dimensions")}
              name="embedding_dimensions"
              defaultValue={String(settings.embedding_dimensions || 1024)}
            >
              {dimensions.map((dimension) => (
                <option key={dimension} value={String(dimension)}>
                  {dimension === 1024 ? t("1024 · default") : dimension}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t("Beijing embedding base URL")}{" "}
          <span className="label-meta">{t("Required for first setup")}</span>
          <input
            aria-label={t("Beijing embedding base URL")}
            name="embedding_base_url"
            type="url"
            defaultValue={settings.embedding_base_url || ""}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            autoComplete="off"
          />
        </label>
        <div className="field-note">
          <span>
            {t(
              "Both the Beijing public endpoint and your Beijing workspace-specific compatible-mode/v1 URL are supported. Workspace endpoints are recommended; model access still depends on your API key.",
            )}
            <code className="block break-all">
              https://dashscope.aliyuncs.com/compatible-mode/v1
            </code>
          </span>
        </div>
        <label>
          {t("Embedding API key")}{" "}
          <span className="label-meta">
            {settings.embedding_api_key_configured
              ? t("Separate key configured; leave blank to keep it")
              : t("Required for first setup")}
          </span>
          <input
            ref={keyInput}
            name="embedding_api_key"
            type="password"
            autoComplete="new-password"
            aria-required={!settings.embedding_api_key_configured}
            placeholder={
              settings.embedding_api_key_configured
                ? t("Leave blank to keep the current embedding key")
                : t("Enter your Beijing Model Studio API key")
            }
          />
        </label>
        <div className="field-note">
          <LockKeyhole size={13} />{" "}
          {t(
            "Keys are encrypted on the server and never returned to the browser. A DeepSeek key is never used for embeddings.",
          )}
        </div>
      </fieldset>
      <div className="provider-presets">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={testLabel}
          disabled={disabled}
          onClick={() => void testConnection()}
        >
          {check.isPending ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <FlaskConical size={14} />
          )}
          {testLabel}
        </Button>
        {settings.embedding_api_key_configured && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void removeKey()}
          >
            {t("Remove embedding key")}
          </Button>
        )}
      </div>
      <div className="field-note">
        {t(
          "Test the current fields without saving. A blank key reuses your saved key only when the endpoint is unchanged. The fixed text check may incur a small charge and never sends your memories.",
        )}
      </div>
      {currentCheck && check.error && (
        <div className="error-banner" role="alert">
          {check.error instanceof Error
            ? errorText(check.error.message)
            : t("Embedding connection check failed")}
        </div>
      )}
      {serverSettingsChanged && (
        <div className="error-banner" role="alert">
          {t(
            "Saved embedding settings changed on the server. Refresh this page and test again.",
          )}
        </div>
      )}
      {currentCheck && check.data && !serverSettingsChanged && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={16} />{" "}
          {t(
            "The current endpoint returned a valid {dimensions}-dimension embedding from {model}. Save to apply any changes.",
            { dimensions: check.data.dimensions, model: check.data.model },
          )}
        </div>
      )}
      <div className="field-note">
        <ShieldCheck size={13} />{" "}
        {t(
          "Saving or testing this configuration does not enable Hy Memory indexing. Its data storage and authorization still need separate setup.",
        )}
      </div>
    </section>
  );
}
