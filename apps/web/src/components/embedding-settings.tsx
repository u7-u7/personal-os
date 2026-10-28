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
      aria-labelledby="embedding-heading"
    >
      <div className="settings-section-heading">
        <span className="small-icon">
          <Database size={21} />
        </span>
        <div>
          <h2 id="embedding-heading">Your embedding model</h2>
          <p>
            Qwen3.7 Embedding Flash converts text into vectors for memory
            retrieval. It uses a separate Model Studio API key from your chat
            model.
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
            Embedding model ID
            <input
              name="embedding_model"
              value="qwen3.7-text-embedding-flash"
              readOnly
            />
          </label>
          <label>
            Vector dimensions
            <select
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
          Beijing workspace base URL
          <input
            name="embedding_base_url"
            type="url"
            defaultValue={settings.embedding_base_url || ""}
            placeholder="https://YOUR-WORKSPACE-ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
            autoComplete="off"
          />
        </label>
        <div className="field-note">
          Copy the OpenAI-compatible base URL from your Beijing Model Studio
          workspace. Your workspace ID is required; no endpoint is assumed.
        </div>
        <label>
          Embedding API key{" "}
          <span className="label-meta">
            {settings.embedding_api_key_configured
              ? "A separate key is securely configured"
              : "No embedding key configured"}
          </span>
          <input
            ref={keyInput}
            name="embedding_api_key"
            type="password"
            autoComplete="new-password"
            placeholder={
              settings.embedding_api_key_configured
                ? "Leave blank to keep the current embedding key"
                : "Enter your Beijing Model Studio API key"
            }
          />
        </label>
        <div className="field-note">
          <LockKeyhole size={13} /> Encrypted on the server and never returned
          to your browser. Your DeepSeek key is not used for embeddings.
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
            <LoaderCircle className="spin" size={14} />
          ) : (
            <FlaskConical size={14} />
          )}
          Test saved embedding connection
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
        Save changes before testing a new configuration. The check sends a
        fixed, nonprivate probe and does not upload your memories.
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
