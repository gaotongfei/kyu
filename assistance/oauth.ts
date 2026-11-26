import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import 'server-only';
import { authorizeEndpoint, directScope, exchangeCode, resource } from './chatgpt';
import { AiError, isLocalOrigin, type AiSettings } from './model';
import { listProviderModels } from './providers';
import { cacheModels } from './settings';
import { withSettings, type ChatGPTRegistration, type PendingSignIn } from './storage';

const callbackError = 'ChatGPT sign-in callback is invalid or already used. Start sign-in again.';
const randomValue = () => randomBytes(32).toString('base64url');

function sameState(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startChatGPTSignIn(origin: string): Promise<{ url: string }> {
  if (typeof origin !== 'string' || !isLocalOrigin(origin)) {
    throw new AiError(
      'ChatGPT sign-in requires a same-computer HTTP loopback install. Use an API key on a remote server.'
    );
  }
  const local = new URL(origin);
  const redirectUri = new URL(
    '/auth/callback',
    `http://127.0.0.1${local.port ? `:${local.port}` : ''}`
  ).href;
  return withSettings(async (store) => {
    const registration = store.get<ChatGPTRegistration>('chatgpt');
    const pending: PendingSignIn = {
      state: randomValue(),
      nonce: randomValue(),
      verifier: randomValue(),
      redirectUri,
      expiresAt: Date.now() + 10 * 60_000,
      clientId: registration?.clientId ?? null,
      phase: 'waiting',
    };
    store.set('pending', pending);
    store.document.signIn = { pending: true, error: null };
    const url = new URL(authorizeEndpoint);
    url.search = new URLSearchParams({
      client_id: pending.clientId ?? 'dynamic_agent_client',
      ...(pending.clientId ? {} : { agent_name_hint: 'Kyu' }),
      ext_agent_host_id: `urn:uuid:${store.hostId}`,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: `openid profile email offline_access resource.invoke ${directScope}`,
      resource,
      state: pending.state,
      nonce: pending.nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
    }).toString();
    // No id_token_hint: keep saved tokens entirely server-side, even in transient URLs.
    return { url: url.href };
  });
}

export async function cancelChatGPTSignIn(): Promise<AiSettings> {
  return withSettings(async (store) => {
    store.set('pending', undefined);
    store.document.signIn = { pending: false, error: null };
    return store.publicSettings();
  });
}

function callbackUrl(value: string): URL {
  try {
    if (typeof value !== 'string' || value.length > 20_000) {
      throw new Error('Invalid callback');
    }
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/auth/callback' ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error('Invalid callback');
    }
    for (const key of ['state', 'code', 'client_id', 'error', 'scope']) {
      if (url.searchParams.getAll(key).length > 1) {
        throw new Error('Ambiguous callback');
      }
    }
    return url;
  } catch {
    throw new AiError(callbackError);
  }
}

export async function completeChatGPTSignIn(value: string): Promise<void> {
  const url = callbackUrl(value);
  // Claim/consume the callback and persist an initially issued client BEFORE token exchange.
  // This separate committed transaction also retains registration after invalid_grant/failure.
  const claimed = await withSettings(async (store) => {
    const pending = store.get<PendingSignIn>('pending');
    const state = url.searchParams.get('state');
    if (
      !pending ||
      pending.phase !== 'waiting' ||
      !state ||
      !sameState(state, pending.state) ||
      `${url.origin}${url.pathname}` !== pending.redirectUri
    ) {
      throw new AiError(callbackError);
    }
    const stop = (error: string) => {
      store.set('pending', undefined);
      store.document.signIn = { pending: false, error };
      return { error };
    };
    if (pending.expiresAt <= Date.now()) {
      return stop('ChatGPT sign-in expired. Try again.');
    }
    if (url.searchParams.has('error')) {
      return stop(
        url.searchParams.get('error') === 'access_denied'
          ? 'ChatGPT sign-in was canceled or plan access was not granted. Try again to authorize it.'
          : 'ChatGPT sign-in was not completed. Try again.'
      );
    }
    const code = url.searchParams.get('code');
    const issued = url.searchParams.get('client_id');
    const clientId = pending.clientId ?? issued;
    if (
      !code ||
      code.length > 8_192 ||
      /\s/.test(code) ||
      !clientId ||
      clientId === 'dynamic_agent_client' ||
      !/^[A-Za-z0-9._-]{1,256}$/.test(clientId) ||
      (issued !== null && issued !== clientId)
    ) {
      return stop('ChatGPT registration was incomplete or changed. Try signing in again.');
    }
    const registration = store.get<ChatGPTRegistration>('chatgpt') ?? { clientId };
    if (registration.clientId !== clientId) {
      return stop('ChatGPT registration changed. Try signing in again.');
    }
    store.set('chatgpt', registration);
    store.set('pending', { ...pending, phase: 'exchanging' });
    return { pending, registration, code };
  });
  if ('error' in claimed) {
    throw new AiError(claimed.error);
  }
  const error = await withSettings(async (store) => {
    const current = store.get<PendingSignIn>('pending');
    if (
      !current ||
      current.phase !== 'exchanging' ||
      !sameState(current.state, claimed.pending.state)
    ) {
      throw new AiError(callbackError);
    }
    let failure: string | null = null;
    try {
      if (current.expiresAt <= Date.now()) {
        throw new AiError('ChatGPT sign-in expired. Try again.');
      }
      const registration = await exchangeCode(claimed.pending, claimed.code, claimed.registration);
      store.set('chatgpt', registration);
      store.document.connections.chatgpt.connected = true;
      store.document.connections.chatgpt.accountLabel = registration.email ?? 'ChatGPT account';
      try {
        cacheModels(
          store,
          'chatgpt',
          await listProviderModels({
            provider: 'chatgpt',
            token: registration.session!.accessToken,
          })
        );
      } catch {
        failure = 'ChatGPT connected. Refresh models to choose a model.';
      }
    } catch {
      failure = 'ChatGPT sign-in could not be verified. Try signing in again.';
    }
    store.set('pending', undefined);
    store.document.signIn = { pending: false, error: failure };
    return failure;
  });
  if (error) {
    throw new AiError(error);
  }
}
