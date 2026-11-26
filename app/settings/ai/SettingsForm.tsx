'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  aiProviders,
  providerNames,
  type AiProvider,
  type AiResult,
  type AiSettings,
  type ApiKeyProvider,
} from '../../../assistance/model';
import { ConfirmDialog } from '../../../components/Assistance/ConfirmDialog';
import { StatusIcon } from '../../../components/Assistance/StatusIcon';
import { SiteHeader } from '../../../components/SiteHeader/SiteHeader';
import {
  beginChatGPTSignIn,
  cancelAiSignIn,
  connectAiProvider,
  loadAiSettings,
  refreshAiModels,
  removeAiConnection,
  saveAiSelection,
} from './actions';
import styles from '../../../components/Assistance/Assistance.module.css';

type Props = {
  initialSettings: AiSettings | null;
  initialError?: string;
  localChatGPT: boolean;
  returnHref: string;
  settingsHref: string;
};

function suggestedModel(settings: AiSettings | null, provider: AiProvider) {
  const connection = settings?.connections[provider];
  return (
    connection?.model ??
    (connection?.models.some((model) => model.id === 'gpt-5.4-mini') ? 'gpt-5.4-mini' : '')
  );
}

export function AiSettingsForm({
  initialSettings,
  initialError,
  localChatGPT,
  returnHref,
  settingsHref,
}: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState(initialError ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [provider, setProvider] = useState<AiProvider>(initialSettings?.activeProvider ?? 'openai');
  const [model, setModel] = useState(
    suggestedModel(initialSettings, initialSettings?.activeProvider ?? 'openai')
  );
  const [keys, setKeys] = useState<Record<ApiKeyProvider, string>>({ openai: '', openrouter: '' });
  const [authUrl, setAuthUrl] = useState('');
  const [savedSelection, setSavedSelection] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AiProvider | null>(null);

  useEffect(() => {
    if (!settings?.signIn.pending) {
      setAuthUrl('');
      return;
    }
    let disposed = false;
    let reading = false;
    const timer = window.setInterval(async () => {
      if (reading) {
        return;
      }
      reading = true;
      try {
        const result = await loadAiSettings();
        if (!disposed) {
          if (result.ok) {
            setSettings(result.value);
          } else {
            setError(result.error);
          }
        }
      } catch {
        if (!disposed) {
          setError('Could not check sign-in. Retry from AI settings.');
        }
      } finally {
        reading = false;
      }
    }, 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings?.signIn.pending]);

  async function perform(
    label: string,
    operation: () => Promise<AiResult<AiSettings>>,
    nextProvider = provider
  ) {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(label);
    setError('');
    setSavedSelection(false);
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSettings(result.value);
      setProvider(nextProvider);
      setModel(suggestedModel(result.value, nextProvider));
      if (label === 'Save selection') {
        setSavedSelection(true);
      }
    } catch {
      setError('The request could not be completed. Check AI settings and retry.');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function connect(event: FormEvent, apiProvider: ApiKeyProvider) {
    event.preventDefault();
    const key = keys[apiProvider];
    setKeys((current) => ({ ...current, [apiProvider]: '' }));
    void perform(
      `Connect ${providerNames[apiProvider]}`,
      () => connectAiProvider(apiProvider, key),
      apiProvider
    );
  }

  async function beginSignIn() {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy('Start ChatGPT sign-in');
    setError('');
    try {
      const result = await beginChatGPTSignIn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const state = await loadAiSettings();
      if (state.ok) {
        setSettings(state.value);
        setAuthUrl(result.value.url);
      } else {
        setError(state.error);
      }
    } catch {
      setError('Could not start ChatGPT sign-in. Retry from AI settings.');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const enabled = Boolean(settings?.encryptionConfigured);
  const selected = settings?.connections[provider];
  const chatgpt = settings?.connections.chatgpt;
  const unavailable = Boolean(busy) || !enabled;
  const selectionUnavailable =
    unavailable || !selected?.connected || !model || (provider === 'chatgpt' && !localChatGPT);

  return (
    <div className={styles.canvas}>
      <div className={styles.frame}>
        <SiteHeader activePage="jobs" />
        <main className={styles.main}>
          <a href={returnHref} className={styles.link}>
            ← Back
          </a>
          <div className={styles.headingRow}>
            <h1 className={styles.heading}>AI settings</h1>
            {busy && <StatusIcon kind="busy" label={busy} />}
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {!settings && (
            <button
              type="button"
              className={styles.button}
              disabled={Boolean(busy)}
              onClick={() => void perform('Retry settings', loadAiSettings)}
            >
              Retry settings
            </button>
          )}
          {settings && !enabled && (
            <section className={styles.card} aria-label="AI setup">
              <h2>Configure encryption</h2>
              <p>
                Set <code>KYU_AI_ENCRYPTION_KEY</code> in the server environment, then restart Kyu.
                Generate a 32-byte key:
              </p>
              <code className={styles.code}>
                node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
              </code>
              <p className={styles.warning}>
                Keep this key private and backed up. Losing it makes saved connections unreadable.
              </p>
              <a href={settingsHref} className={styles.link}>
                Reload settings
              </a>
            </section>
          )}
          <div className={styles.settings}>
            <form
              className={styles.card}
              onSubmit={(event) => {
                event.preventDefault();
                void perform('Save selection', () => saveAiSelection(provider, model));
              }}
            >
              <div className={styles.cardHeading}>
                <h2>Generation</h2>
                {savedSelection && <StatusIcon kind="check" label="AI selection saved" />}
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label htmlFor="ai-provider" className={styles.label}>
                    Connection
                  </label>
                  <select
                    id="ai-provider"
                    className={styles.select}
                    value={provider}
                    disabled={unavailable}
                    onChange={(event) => {
                      const next = event.target.value as AiProvider;
                      setProvider(next);
                      setModel(suggestedModel(settings, next));
                      setSavedSelection(false);
                    }}
                  >
                    {aiProviders.map((value) => (
                      <option
                        key={value}
                        value={value}
                        disabled={value === 'chatgpt' && !localChatGPT}
                      >
                        {providerNames[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="ai-model" className={styles.label}>
                    Model
                  </label>
                  <select
                    id="ai-model"
                    className={styles.select}
                    value={model}
                    disabled={unavailable || !selected?.connected}
                    required
                    onChange={(event) => {
                      setModel(event.target.value);
                      setSavedSelection(false);
                    }}
                  >
                    <option value="">Choose a model</option>
                    {selected?.models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name === entry.id ? entry.id : `${entry.name} · ${entry.id}`}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={styles.button}
                  disabled={
                    unavailable || !selected?.connected || (provider === 'chatgpt' && !localChatGPT)
                  }
                  onClick={() => void perform('Refresh models', () => refreshAiModels(provider))}
                >
                  Refresh models
                </button>
              </div>
              <div className={styles.actions} style={{ marginTop: 'var(--kyu-space-4)' }}>
                <button
                  type="submit"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={selectionUnavailable}
                >
                  Save selection
                </button>
                {selected?.connected && (
                  <span className={styles.muted}>
                    {provider === 'chatgpt'
                      ? 'Uses your ChatGPT plan allowance'
                      : `Billed through your ${provider === 'openai' ? 'OpenAI API' : 'OpenRouter'} account`}
                  </span>
                )}
              </div>
            </form>
            {(['openai', 'openrouter'] as const).map((apiProvider) => (
              <form
                key={apiProvider}
                className={styles.card}
                onSubmit={(event) => connect(event, apiProvider)}
              >
                <div className={styles.cardHeading}>
                  <h2>{providerNames[apiProvider]}</h2>
                  {settings?.connections[apiProvider].connected && (
                    <StatusIcon kind="check" label={`${providerNames[apiProvider]} key saved`} />
                  )}
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor={`${apiProvider}-key`} className={styles.label}>
                      {settings?.connections[apiProvider].connected ? 'Replace API key' : 'API key'}
                    </label>
                    <input
                      id={`${apiProvider}-key`}
                      className={styles.input}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={4_096}
                      required
                      value={keys[apiProvider]}
                      disabled={unavailable}
                      onChange={(event) =>
                        setKeys((current) => ({ ...current, [apiProvider]: event.target.value }))
                      }
                    />
                  </div>
                  <button
                    type="submit"
                    className={styles.button}
                    disabled={unavailable || !keys[apiProvider].trim()}
                  >
                    Connect
                  </button>
                  {settings?.connections[apiProvider].connected && (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={unavailable}
                      onClick={() => setRemoveTarget(apiProvider)}
                    >
                      Remove key
                    </button>
                  )}
                </div>
              </form>
            ))}
            <section className={styles.card} aria-labelledby="chatgpt-heading">
              <div className={styles.cardHeading}>
                <h2 id="chatgpt-heading">ChatGPT subscription</h2>
                {chatgpt?.connected && <StatusIcon kind="check" label="ChatGPT connected" />}
              </div>
              {chatgpt?.accountLabel && <p>{chatgpt.accountLabel}</p>}
              {!localChatGPT && (
                <p className={styles.warning}>
                  ChatGPT sign-in requires a supported same-computer installation at an HTTP
                  loopback address. Use an API-key connection on this server.
                </p>
              )}
              <div className={styles.actions}>
                {settings?.signIn.pending ? (
                  <>
                    {authUrl && (
                      <a
                        href={authUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={`${styles.button} ${styles.primary}`}
                      >
                        Open ChatGPT sign-in ↗
                      </a>
                    )}
                    <StatusIcon kind="busy" label="Waiting for ChatGPT sign-in" />
                    <button
                      type="button"
                      className={styles.button}
                      disabled={unavailable}
                      onClick={() => {
                        setAuthUrl('');
                        void perform('Cancel sign-in', cancelAiSignIn);
                      }}
                    >
                      Cancel sign-in
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={unavailable || !localChatGPT}
                    onClick={() => void beginSignIn()}
                  >
                    Continue with ChatGPT
                  </button>
                )}
                {chatgpt?.connected && (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={unavailable}
                    onClick={() => setRemoveTarget('chatgpt')}
                  >
                    Disconnect
                  </button>
                )}
                <a
                  href="https://chatgpt.com/settings/usage"
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.link}
                >
                  Manage usage ↗
                </a>
              </div>
              {settings?.signIn.error && (
                <p className={styles.error} role="alert">
                  {settings.signIn.error}
                </p>
              )}
              {localChatGPT && (
                <p className={styles.notice}>
                  Requires an eligible ChatGPT plan and permission to use its allowance. Preview
                  restrictions apply.
                </p>
              )}
            </section>
          </div>
        </main>
      </div>
      <ConfirmDialog
        opened={removeTarget !== null}
        title="Remove connection"
        confirmLabel="Remove connection"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) {
            const target = removeTarget;
            setRemoveTarget(null);
            void perform('Remove connection', () => removeAiConnection(target));
          }
        }}
      >
        <p>
          {removeTarget === 'chatgpt'
            ? 'Disconnect this ChatGPT session?'
            : `Remove the saved ${removeTarget ? providerNames[removeTarget] : ''} API key?`}
        </p>
      </ConfirmDialog>
    </div>
  );
}
