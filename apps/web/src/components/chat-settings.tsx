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
import { useI18n } from "@/components/i18n-provider";

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
  const { t, errorText } = useI18n();
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
          <h2 id="chat-configuration-heading">{t("1. Your AI model")}</h2>
          <p>
            {t(
              "Enter an OpenAI-compatible model, endpoint and key for conversations, task understanding and daily AI briefings.",
            )}
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
          <span>{t("Quick setup")}</span>
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
          <span className="field-note">
            {t("The preset fills fields only. Add your key, then save.")}
          </span>
        </div>
        <div className="form-grid">
          <label>
            {t("Model ID")}{" "}
            <span className="label-meta">
              {t("Chat model name · required")}
            </span>
            <input
              aria-label={t("Model ID")}
              name="model"
              defaultValue={settings.model || ""}
              placeholder={t("The model ID from your provider")}
              required
            />
          </label>
          <label>
            {t("Provider base URL")}{" "}
            <span className="label-meta">
              {t("Chat API endpoint · required")}
            </span>
            <input
              aria-label={t("Provider base URL")}
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
          {t("API key")}{" "}
          <span className="label-meta">
            {settings.api_key_configured
              ? t("Key configured; leave blank to keep it")
              : t("Required for first setup")}
          </span>
          <input
            name="api_key"
            type="password"
            autoComplete="new-password"
            aria-required={!settings.api_key_configured}
            placeholder={
              settings.api_key_configured
                ? t("Leave blank to keep the current key")
                : t("Enter your chat provider API key")
            }
          />
        </label>
        <div className="field-note">
          <LockKeyhole size={13} />{" "}
          {t(
            "Keys are encrypted on the server and never returned to the browser.",
          )}
          {settings.chat_config_source === "server_default"
            ? t("Currently using the server default configuration.")
            : settings.chat_config_source === "personal"
              ? t("Currently using your personal configuration.")
              : t("No complete chat connection has been configured.")}
        </div>
        <div className="form-grid">
          <label>
            {t("Fast routing model")}{" "}
            <span className="label-meta">{t("optional")}</span>
            <input
              aria-label={t("Fast routing model")}
              name="fast_model"
              defaultValue={settings.fast_model || ""}
              placeholder={t("Leave blank to use the main model")}
            />
          </label>
          <label>
            {t("Reasoning routing model")}{" "}
            <span className="label-meta">{t("optional")}</span>
            <input
              aria-label={t("Reasoning routing model")}
              name="reasoning_model"
              defaultValue={settings.reasoning_model || ""}
              placeholder={t("Leave blank to use the main model")}
            />
          </label>
        </div>
        <label>
          {t("How to route requests")}
          <select
            name="decision_provider"
            defaultValue={settings.decision_provider || "rules"}
          >
            <option value="rules">{t("Fast rules · default")}</option>
            <option value="llm">{t("Your language model")}</option>
            <option value="jev">
              {t("Jev · requires server authorization")}
            </option>
          </select>
        </label>
        <div className="field-note">
          <ShieldCheck size={13} />{" "}
          {t(
            "Routing only selects models; sensitive actions still need your approval.",
          )}
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
          {t("Test saved chat connection")}
        </Button>
        {settings.api_key_configured && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (
                !confirm(
                  t(
                    "Remove the chat API key? Chat and AI briefings will become unavailable.",
                  ),
                )
              )
                return;
              check.reset();
              void onRemoveKey().then((ok) => {
                const input =
                  fields.current?.form?.elements.namedItem("api_key");
                if (ok && input instanceof HTMLInputElement) input.value = "";
              });
            }}
          >
            {t("Remove chat key")}
          </Button>
        )}
      </div>
      <div className="field-note">
        {t(
          "Save before testing. The check sends a fixed short message to the saved model and may incur a small provider charge. It never sends your conversations or memories.",
        )}
      </div>
      {currentCheck && check.error && (
        <div className="error-banner" role="alert">
          {errorText(check.error.message)}
        </div>
      )}
      {serverSettingsChanged && (
        <div className="error-banner" role="alert">
          {t(
            "Saved chat settings changed on the server. Refresh this page and test again.",
          )}
        </div>
      )}
      {currentCheck && check.data && !serverSettingsChanged && (
        <div className="success-banner" role="status">
          <CheckCircle2 size={16} />{" "}
          {t(
            "The saved {model} returned real text. The chat connection check passed.",
            { model: check.data.model },
          )}
        </div>
      )}
    </section>
  );
}
