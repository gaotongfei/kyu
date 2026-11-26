import 'server-only';
import { renewRegistration, revokeRegistration } from './chatgpt';
import {
  AiError,
  isProvider,
  validModel,
  type AiModel,
  type AiProvider,
  type AiSettings,
  type ApiKeyProvider,
  type ResolvedConnection,
  type SelectedConnection,
} from './model';
import { listProviderModels } from './providers';
import {
  readStoredSettings,
  withSettings,
  type ChatGPTRegistration,
  type SettingsStore,
} from './storage';

export async function readSettings(): Promise<AiSettings> {
  return readStoredSettings();
}

function assertProvider(provider: unknown): asserts provider is AiProvider {
  if (!isProvider(provider)) {
    throw new AiError('Choose a supported AI connection.');
  }
}

export function cacheModels(store: SettingsStore, provider: AiProvider, models: AiModel[]): void {
  if (!Array.isArray(models) || models.length > 10_000) {
    throw new AiError(
      'The provider returned an invalid model catalog. Refresh models to try again.'
    );
  }
  const unique = new Map<string, AiModel>();
  for (const item of models) {
    validModel(item?.id);
    if (
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 300 ||
      /\p{Cc}/u.test(item.name)
    ) {
      throw new AiError(
        'The provider returned an invalid model catalog. Refresh models to try again.'
      );
    }
    unique.set(item.id, { id: item.id, name: item.name });
  }
  const connection = store.document.connections[provider];
  const previousModel = connection.model;
  connection.models = [...unique.values()];
  if (previousModel && !unique.has(previousModel)) {
    connection.model = null;
    if (store.document.activeProvider === provider) {
      store.document.activeProvider = null;
    }
  } else if (!previousModel && unique.has('gpt-5.4-mini')) {
    connection.model = 'gpt-5.4-mini';
  }
  store.touch();
}

export async function connectionToken(store: SettingsStore, provider: AiProvider): Promise<string> {
  if (!store.document.connections[provider].connected) {
    throw new AiError('Connect this provider before continuing. No other provider was used.');
  }
  if (provider !== 'chatgpt') {
    const credential = store.get<{ key: string }>(provider);
    if (!credential?.key) {
      throw new AiError('Reconnect this provider before continuing.');
    }
    return credential.key;
  }
  let registration = store.get<ChatGPTRegistration>('chatgpt');
  if (!registration?.session || !registration.subject) {
    throw new AiError('Reconnect ChatGPT before continuing.');
  }
  if (registration.session.expiresAt <= Date.now() + 60_000) {
    registration = await renewRegistration(registration);
    store.set('chatgpt', registration);
  }
  return registration.session!.accessToken;
}

export async function connectApiKey(provider: ApiKeyProvider, key: string): Promise<AiSettings> {
  if (provider !== 'openai' && provider !== 'openrouter') {
    throw new AiError('Choose OpenAI API or OpenRouter for an API key.');
  }
  if (
    typeof key !== 'string' ||
    key.trim().length < 8 ||
    key.trim().length > 4_096 ||
    !/^[\x21-\x7e]+$/.test(key.trim())
  ) {
    throw new AiError('Enter a valid API key between 8 and 4,096 characters.');
  }
  const token = key.trim();
  return withSettings(async (store) => {
    store.get(provider); // Detect an unreadable previous credential before any provider request.
    const models = await listProviderModels({ provider, token });
    cacheModels(store, provider, models);
    store.set(provider, { key: token });
    store.document.connections[provider].connected = true;
    return store.publicSettings();
  });
}

export async function removeConnection(provider: AiProvider): Promise<AiSettings> {
  assertProvider(provider);
  return withSettings(async (store) => {
    if (provider === 'chatgpt') {
      const registration = store.get<ChatGPTRegistration>('chatgpt');
      const confirmed = registration ? await revokeRegistration(registration) : true;
      if (registration) {
        const { session: _session, ...retained } = registration;
        store.set('chatgpt', retained);
      }
      store.set('pending', undefined);
      store.document.signIn = {
        pending: false,
        error: confirmed
          ? null
          : 'Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.',
      };
    } else {
      store.set(provider, undefined);
    }
    store.document.connections[provider] = { connected: false, model: null, models: [] };
    if (store.document.activeProvider === provider) {
      store.document.activeProvider = null;
    }
    store.touch();
    return store.publicSettings();
  });
}

export async function refreshModels(provider: AiProvider): Promise<AiSettings> {
  assertProvider(provider);
  const result = await withSettings(async (store) => {
    const token = await connectionToken(store, provider);
    try {
      cacheModels(store, provider, await listProviderModels({ provider, token }));
      if (provider === 'chatgpt') {
        store.document.signIn.error = null;
      }
      return { settings: store.publicSettings() };
    } catch (error) {
      // Commit any successful rotating-token renewal even when the catalog request fails.
      return {
        error:
          error instanceof AiError
            ? error
            : new AiError('Models could not be refreshed. Try again explicitly.'),
      };
    }
  });
  if (result.error) {
    throw result.error;
  }
  return result.settings!;
}

export async function selectConnection(provider: AiProvider, model: string): Promise<AiSettings> {
  assertProvider(provider);
  validModel(model);
  return withSettings(async (store) => {
    const connection = store.document.connections[provider];
    if (!connection.connected || !connection.models.some((item) => item.id === model)) {
      throw new AiError('Connect this provider and choose a model from its cached catalog.');
    }
    connection.model = model;
    store.document.activeProvider = provider;
    store.touch();
    return store.publicSettings();
  });
}

export async function resolveGenerationConnection(
  expected: SelectedConnection
): Promise<ResolvedConnection> {
  if (!expected) {
    throw new AiError('Choose an AI connection and model.');
  }
  assertProvider(expected.provider);
  validModel(expected.model);
  return withSettings(async (store) => {
    const connection = store.document.connections[expected.provider];
    // This comparison precedes credential decryption, renewal, discovery, or provider requests.
    if (
      store.document.activeProvider !== expected.provider ||
      connection.model !== expected.model ||
      !connection.connected
    ) {
      throw new AiError(
        'The selected AI connection changed. Review the provider and model, then generate again.'
      );
    }
    if (!connection.models.some((item) => item.id === expected.model)) {
      throw new AiError('Choose an available model from this connection. No other model was used.');
    }
    const token = await connectionToken(store, expected.provider);
    return { provider: expected.provider, model: expected.model, token };
  });
}
