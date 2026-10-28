"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  type ChatBalance,
  type ChatConnectionCheck,
  type ChatModelList,
  type Settings,
} from "@/lib/api";

type RequestStamp = {
  settingsVersion: number;
  connectionRevision: number;
  probeRevision: number;
};

type Receipt<T> = T & { request: RequestStamp };
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
  const modelListId = useId();
  const revisions = useRef({ connection: 0, probe: 0 });
  const [visibleRevision, setVisibleRevision] = useState({
    connection: 0,
    probe: 0,
  });
  const locked = useRef(false);
  const automaticVersion = useRef<number | null>(null);
  const requestDraft = useCallback(
    async <T,>(
      operation: string,
      stamp: RequestStamp,
      needsModel = false,
    ): Promise<Receipt<T>> => {
      const form = fields.current?.form;
      if (!form) throw new Error("Chat configuration is not ready.");
      const input = (name: string) => {
        const field = form.elements.namedItem(name);
        return field instanceof HTMLInputElement ? field : null;
      };
      const endpoint = input("base_url");
      const model = input("model");
      const baseUrl = endpoint?.value.trim() || "";
      let validEndpoint = false;
      try {
        const parsed = new URL(baseUrl);
        validEndpoint =
          ["https:", "http:"].includes(parsed.protocol) && !!parsed.hostname;
      } catch {
        // Native validation is not reliable while the fieldset is disabled.
      }
      if (!validEndpoint) {
        endpoint?.reportValidity();
        throw new Error("Enter a valid chat provider base URL.");
      }
      if (needsModel && !model?.value.trim()) {
        model?.reportValidity();
        throw new Error("Enter a chat model ID before testing.");
      }
      // Credentials stay out of mutation variables, state and query keys.
      const key = input("api_key")?.value.trim();
      const data = await api<T>(`/settings/chat/${operation}`, {
        method: "POST",
        body: JSON.stringify({
          version: stamp.settingsVersion,
          base_url: baseUrl,
          model: model?.value.trim() || "",
          ...(key ? { api_key: key } : {}),
        }),
      });
      return { ...data, request: stamp };
    },
    [],
  );
  const check = useMutation({
    mutationFn: (stamp: RequestStamp) =>
      requestDraft<ChatConnectionCheck>("test", stamp, true),
  });
  const models = useMutation({
    mutationFn: (stamp: RequestStamp) =>
      requestDraft<ChatModelList>("models", stamp),
  });
  const balance = useMutation({
    mutationFn: (stamp: RequestStamp) =>
      requestDraft<ChatBalance>("balance", stamp),
  });
  const { mutateAsync: testChat } = check;
  const { mutateAsync: fetchModels } = models;
  const { mutateAsync: fetchBalance } = balance;
  const disabled =
    pending || check.isPending || models.isPending || balance.isPending;
  const current = (stamp: RequestStamp | undefined, probe = false) =>
    !!stamp &&
    stamp.settingsVersion === settings.version &&
    stamp.connectionRevision === visibleRevision.connection &&
    (!probe || stamp.probeRevision === visibleRevision.probe);
  const currentCheck = current(check.variables, true);
  const currentModels = current(models.variables);
  const currentBalance = current(balance.variables);
  const serverSettingsChanged =
    (currentCheck &&
      check.data &&
      check.data.settings_version !== settings.version) ||
    (currentModels &&
      models.data &&
      models.data.settings_version !== settings.version) ||
    (currentBalance &&
      balance.data &&
      balance.data.settings_version !== settings.version);
  const availableModels =
    currentModels && models.data?.settings_version === settings.version
      ? models.data.models
      : [];
  function changed(name?: string) {
    if (!name || name === "base_url" || name === "api_key") {
      revisions.current.connection += 1;
      models.reset();
      balance.reset();
    }
    if (
      !name ||
      [
        "base_url",
        "api_key",
        "model",
        "fast_model",
        "reasoning_model",
      ].includes(name)
    ) {
      revisions.current.probe += 1;
      check.reset();
    }
    setVisibleRevision({ ...revisions.current });
    onChange();
  }
  const run = useCallback(
    async (operation: "test" | "models" | "balance") => {
      if (pending || locked.current) return;
      locked.current = true;
      onTestPendingChange(true);
      const stamp = {
        settingsVersion: settings.version,
        connectionRevision: revisions.current.connection,
        probeRevision: revisions.current.probe,
      };
      try {
        if (operation === "test") await testChat(stamp);
        else if (operation === "models") await fetchModels(stamp);
        else await fetchBalance(stamp);
      } catch {
        // Each operation renders its own real provider failure below.
      } finally {
        locked.current = false;
        onTestPendingChange(false);
      }
    },
    [
      pending,
      onTestPendingChange,
      settings.version,
      testChat,
      fetchModels,
      fetchBalance,
    ],
  );
  useEffect(() => {
    if (
      pending ||
      !settings.chat_configured ||
      !settings.base_url ||
      automaticVersion.current === settings.version
    )
      return;
    automaticVersion.current = settings.version;
    // Only discover saved configurations once; typing a key never triggers a request.
    const form = fields.current?.form;
    const key = form?.elements.namedItem("api_key");
    const endpoint = form?.elements.namedItem("base_url");
    if (key instanceof HTMLInputElement && key.value) return;
    if (
      !(endpoint instanceof HTMLInputElement) ||
      endpoint.value !== settings.base_url
    )
      return;
    void run("models");
  }, [
    pending,
    run,
    settings.version,
    settings.chat_configured,
    settings.base_url,
  ]);
  function modelPicker(name: string, label: string) {
    if (!availableModels.length) return null;
    return (
      <select
        aria-label={label}
        value=""
        onChange={(event) => {
          event.stopPropagation();
          const input = fields.current?.form?.elements.namedItem(name);
          if (input instanceof HTMLInputElement && event.target.value) {
            input.value = event.target.value;
            changed(name);
          }
        }}
      >
        <option value="">{t("Choose an available model")}</option>
        {availableModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name && model.name !== model.id
              ? `${model.name} (${model.id})`
              : model.id}
          </option>
        ))}
      </select>
    );
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
        onChange={(event) => {
          const target = event.target;
          changed(
            target instanceof HTMLInputElement ||
              target instanceof HTMLSelectElement
              ? target.name
              : undefined,
          );
        }}
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
              list={modelListId}
              defaultValue={settings.model || ""}
              placeholder={t("The model ID from your provider")}
              required
            />
            {modelPicker("model", t("Choose main model"))}
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
        <datalist id={modelListId}>
          {availableModels.map((model) => (
            <option key={model.id} value={model.id} />
          ))}
        </datalist>
        <div className="provider-presets">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void run("test")}
          >
            {check.isPending ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <FlaskConical size={14} />
            )}
            {t("Test current configuration")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void run("models")}
          >
            <RefreshCw
              size={14}
              className={models.isPending ? "spin" : undefined}
            />
            {t("Fetch available models")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void run("balance")}
          >
            {balance.isPending ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Wallet size={14} />
            )}
            {t("Check provider balance")}
          </Button>
        </div>
        <div className="field-note">
          {t(
            "These actions use the fields above without saving. Re-enter the key when changing the endpoint. The connection test sends a short message and may incur a small charge; model discovery and balance checks do not run inference.",
          )}
        </div>
        {currentCheck && check.error && (
          <div className="error-banner" role="alert">
            <strong>{t("Test current configuration")}: </strong>
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
              "The current {model} returned real text. The chat connection check passed.",
              { model: check.data.model },
            )}
          </div>
        )}
        {currentModels && models.error && (
          <div className="error-banner" role="alert">
            <strong>{t("Fetch available models")}: </strong>
            {errorText(models.error.message)}
          </div>
        )}
        {currentModels && models.data && !serverSettingsChanged && (
          <div className="field-note" role="status">
            {availableModels.length
              ? t(
                  "Retrieved {count} available models. Choose one above or enter a model ID manually.",
                  { count: availableModels.length },
                )
              : t(
                  "The provider returned no available models. You can still enter a model ID manually.",
                )}
          </div>
        )}
        {currentBalance && balance.error && (
          <div className="error-banner" role="alert">
            <strong>{t("Check provider balance")}: </strong>
            {errorText(balance.error.message)}
          </div>
        )}
        {currentBalance && balance.data && !serverSettingsChanged && (
          <div role="status" className="embedding-fields">
            {!balance.data.supported ? (
              <p className="field-note">
                {t("This provider does not offer a supported balance API.")}
              </p>
            ) : (
              <>
                <p className="field-note">
                  {balance.data.is_available
                    ? t("Provider account is available.")
                    : t("Provider account is unavailable.")}
                </p>
                {(balance.data.balance_infos || []).map((info) => (
                  <div className="field-note" key={info.currency}>
                    <strong>
                      {info.currency} · {t("Total balance")}:{" "}
                      {info.total_balance}
                    </strong>
                    <span>
                      {t("Granted balance")}: {info.granted_balance} ·{" "}
                      {t("Topped-up balance")}: {info.topped_up_balance}
                    </span>
                  </div>
                ))}
                {!balance.data.balance_infos?.length && (
                  <p className="field-note">
                    {t("The provider returned no balance details.")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <div className="form-grid">
          <label>
            {t("Fast routing model")}{" "}
            <span className="label-meta">{t("optional")}</span>
            <input
              aria-label={t("Fast routing model")}
              name="fast_model"
              list={modelListId}
              defaultValue={settings.fast_model || ""}
              placeholder={t("Leave blank to use the main model")}
            />
            {modelPicker("fast_model", t("Choose fast routing model"))}
          </label>
          <label>
            {t("Reasoning routing model")}{" "}
            <span className="label-meta">{t("optional")}</span>
            <input
              aria-label={t("Reasoning routing model")}
              name="reasoning_model"
              list={modelListId}
              defaultValue={settings.reasoning_model || ""}
              placeholder={t("Leave blank to use the main model")}
            />
            {modelPicker(
              "reasoning_model",
              t("Choose reasoning routing model"),
            )}
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
              changed();
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
    </section>
  );
}
