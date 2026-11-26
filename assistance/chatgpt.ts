import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import 'server-only';
import { AiError } from './model';
import type { ChatGPTRegistration, PendingSignIn } from './storage';

export const issuer = 'https://auth.openai.com';
export const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
export const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
export const resource = 'https://api.openai.com/v1';
export const directScope = 'chatgpt.tokens.use.direct';
const signInError = 'ChatGPT sign-in could not be verified. Try signing in again.';
const renewalError =
  'ChatGPT renewal failed. Reconnect ChatGPT and try again; no other provider was used.';

type Json = Record<string, unknown>;

function trustedEndpoint(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AiError(signInError);
  }
  const url = new URL(value);
  if (
    url.origin !== issuer ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new AiError(signInError);
  }
  return url.href;
}

async function jsonRequest(url: string, init?: RequestInit): Promise<Json> {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AiError(signInError);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 262_144) {
        throw new AiError(signInError);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const json: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new AiError(signInError);
  }
  return json as Json;
}

async function discovery(): Promise<Json> {
  // Discovery supplies only verification/revocation metadata. Authorization and token
  // requests always use the fixed documented direct-flow endpoints above.
  const metadata = await jsonRequest(`${issuer}/.well-known/openid-configuration`);
  if (metadata.issuer !== issuer) {
    throw new AiError(signInError);
  }
  trustedEndpoint(metadata.authorization_endpoint);
  trustedEndpoint(metadata.token_endpoint);
  if (metadata.revocation_endpoint !== undefined) {
    trustedEndpoint(metadata.revocation_endpoint);
  }
  return metadata;
}

async function identityVerifier(): Promise<ReturnType<typeof createLocalJWKSet>> {
  const metadata = await discovery();
  const jwks = await jsonRequest(trustedEndpoint(metadata.jwks_uri));
  if (!Array.isArray(jwks.keys) || jwks.keys.length > 100) {
    throw new AiError(signInError);
  }
  return createLocalJWKSet(jwks as unknown as JSONWebKeySet);
}

async function verifyIdentity(
  idToken: string,
  clientId: string,
  verifier: ReturnType<typeof createLocalJWKSet>,
  nonce?: string,
  subject?: string
): Promise<{ subject: string; email?: string }> {
  try {
    const { payload } = await jwtVerify(idToken, verifier, {
      issuer,
      audience: clientId,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', ...(nonce ? ['nonce'] : [])],
      clockTolerance: 5,
    });
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 512 ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (subject !== undefined && payload.sub !== subject) ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      !Number.isFinite(payload.iat) ||
      payload.iat! > Date.now() / 1_000 + 5
    ) {
      throw new AiError(signInError);
    }
    const email =
      typeof payload.email === 'string' &&
      payload.email.length <= 254 &&
      !/\p{Cc}/u.test(payload.email)
        ? payload.email
        : undefined;
    return { subject: payload.sub, ...(email ? { email } : {}) };
  } catch {
    throw new AiError(signInError);
  }
}

export async function validateIdentity(
  idToken: string,
  clientId: string,
  nonce?: string,
  subject?: string
): Promise<{ subject: string; email?: string }> {
  try {
    return await verifyIdentity(idToken, clientId, await identityVerifier(), nonce, subject);
  } catch {
    throw new AiError(signInError);
  }
}

function tokenString(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,32768}$/.test(value)) {
    throw new AiError(signInError);
  }
  return value;
}

async function tokenRequest(params: Record<string, string>): Promise<Json> {
  return jsonRequest(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, resource }),
  });
}

function sessionFromResponse(
  json: Json,
  old?: ChatGPTRegistration['session']
): NonNullable<ChatGPTRegistration['session']> {
  let scopes: string[] | undefined;
  if (typeof json.scope === 'string') {
    scopes = json.scope.split(/\s+/).filter(Boolean);
  } else if (json.scope === undefined) {
    scopes = old?.scopes;
  }
  if (
    !scopes?.includes(directScope) ||
    typeof json.token_type !== 'string' ||
    json.token_type.toLowerCase() !== 'bearer' ||
    typeof json.expires_in !== 'number' ||
    !Number.isFinite(json.expires_in) ||
    json.expires_in <= 0 ||
    json.expires_in > 31 * 86_400
  ) {
    throw new AiError(signInError);
  }
  return {
    accessToken: tokenString(json.access_token),
    refreshToken: tokenString(
      json.refresh_token === undefined ? old?.refreshToken : json.refresh_token
    ),
    idToken: tokenString(json.id_token === undefined ? old?.idToken : json.id_token),
    expiresAt: Date.now() + json.expires_in * 1_000,
    scopes,
  };
}

export async function exchangeCode(
  pending: PendingSignIn,
  code: string,
  registration: ChatGPTRegistration
): Promise<ChatGPTRegistration> {
  try {
    const verifier = await identityVerifier();
    const json = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: registration.clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
    });
    const session = sessionFromResponse(json);
    const identity = await verifyIdentity(
      session.idToken,
      registration.clientId,
      verifier,
      pending.nonce,
      registration.subject
    );
    return { clientId: registration.clientId, ...identity, session };
  } catch {
    throw new AiError(signInError);
  }
}

export async function renewRegistration(
  registration: ChatGPTRegistration
): Promise<ChatGPTRegistration> {
  if (!registration.session || !registration.subject) {
    throw new AiError(renewalError);
  }
  try {
    const verifier = await identityVerifier();
    const json = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: registration.clientId,
      refresh_token: registration.session.refreshToken,
    });
    const session = sessionFromResponse(json, registration.session);
    if (json.id_token !== undefined) {
      await verifyIdentity(
        session.idToken,
        registration.clientId,
        verifier,
        undefined,
        registration.subject
      );
    }
    return { ...registration, session };
  } catch {
    throw new AiError(renewalError);
  }
}

export async function revokeRegistration(registration: ChatGPTRegistration): Promise<boolean> {
  if (!registration.session) {
    return true;
  }
  try {
    const metadata = await discovery();
    const endpoint = trustedEndpoint(metadata.revocation_endpoint);
    // A single short backoff retry, only for network/5xx failures, while the token is retained.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: registration.session.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: registration.clientId,
          }),
        });
        await response.body?.cancel();
        if (response.status === 200) {
          return true;
        }
        if (response.status < 500) {
          return false;
        }
      } catch {
        // Never include remote bodies, tokens, or authorization URLs in diagnostics.
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  } catch {
    // Local sign-out still erases the session when discovery/revocation is unavailable.
  }
  return false;
}
