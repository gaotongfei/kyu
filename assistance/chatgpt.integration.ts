// Fixture-only protocol checks; run with NODE_OPTIONS=--conditions=react-server yarn tsx --test assistance/chatgpt.integration.ts.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import type { ChatGPTRegistration, PendingSignIn } from './storage';

const originalFetch = globalThis.fetch;
const issuer = 'https://auth.openai.com';
const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = 'https://api.openai.com/v1';
let protocol: typeof import('./chatgpt');
let importRequests = 0;
const requests: { url: string; init?: RequestInit }[] = [];
const clientId = 'oaiapp_fixture';
const subject = 'fixture-owner';
const nonce = 'fixture-nonce';
const jwksUrl = `${issuer}/.well-known/jwks.json`;
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
let privateKey: CryptoKey;
let jwks: unknown;
let metadata: Record<string, unknown>;
let tokenResponse: Record<string, unknown>;
let revokeStatus: number;
let jwksResponse: unknown;
const pending: PendingSignIn = {
  state: 'fixture-state',
  nonce,
  verifier: 'fixture-verifier',
  redirectUri: 'http://127.0.0.1:3000/auth/callback',
  expiresAt: Date.now() + 600_000,
  clientId: null,
  phase: 'waiting',
};

async function signed(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ nonce, email: 'owner@example.test', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer((claims.iss as string) ?? issuer)
    .setAudience((claims.aud as string) ?? clientId)
    .setSubject((claims.sub as string) ?? subject)
    .setIssuedAt((claims.iat as number) ?? Math.floor(Date.now() / 1000))
    .setExpirationTime((claims.exp as number) ?? Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);
}

before(async () => {
  globalThis.fetch = async () => {
    importRequests += 1;
    throw new Error('Network on import is prohibited');
  };
  protocol = await import('./chatgpt');
  await import('./settings');
  await import('./oauth');
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  jwks = {
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'fixture-key', use: 'sig', alg: 'RS256' }],
  };
});

beforeEach(async () => {
  requests.length = 0;
  metadata = {
    issuer,
    authorization_endpoint: authorizeEndpoint,
    token_endpoint: tokenEndpoint,
    jwks_uri: jwksUrl,
    revocation_endpoint: `${issuer}/oauth/revoke`,
  };
  jwksResponse = jwks;
  revokeStatus = 200;
  tokenResponse = {
    access_token: 'fixture-access',
    refresh_token: 'fixture-refresh',
    id_token: await signed(),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid email offline_access resource.invoke chatgpt.tokens.use.direct',
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    assert.equal(init?.redirect, 'error', 'Every protocol request must reject redirects');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    if (url === discoveryUrl) {
      return Response.json(metadata);
    }
    if (url === jwksUrl) {
      return Response.json(jwksResponse);
    }
    if (url === tokenEndpoint) {
      return Response.json(tokenResponse);
    }
    if (url === `${issuer}/oauth/revoke`) {
      return new Response(null, { status: revokeStatus });
    }
    throw new Error('Unexpected fixture request; live network is prohibited');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

test('importing the protocol module makes no network requests', () => {
  assert.equal(requests.length, 0);
  assert.equal(importRequests, 0);
});

test('validates signed OIDC identity against trusted discovery/JWKS and saved nonce/client', async () => {
  assert.deepEqual(await protocol.validateIdentity(await signed(), clientId, nonce), {
    subject,
    email: 'owner@example.test',
  });
  assert.deepEqual(
    requests.map(({ url }) => url),
    [discoveryUrl, jwksUrl]
  );
});

test('rejects signatures from unknown keys, tampering, and unsigned/unsupported tokens', async () => {
  const valid = await signed();
  const parts = valid.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  payload.sub = 'different-owner';
  const tampered = [
    parts[0],
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    parts[2],
  ].join('.');
  await assert.rejects(
    protocol.validateIdentity(tampered, clientId, nonce),
    /could not be verified/
  );
  jwksResponse = { keys: [] };
  await assert.rejects(protocol.validateIdentity(valid, clientId, nonce), /could not be verified/);
  await assert.rejects(
    protocol.validateIdentity('eyJhbGciOiJub25lIn0.e30.', clientId, nonce),
    /could not be verified/
  );
});

test('rejects wrong issuer, audience, nonce, subject, expiry, future issuance, and ambiguous audience', async () => {
  for (const claims of [
    { iss: 'https://attacker.example' },
    { aud: 'other-client' },
    { nonce: 'wrong-nonce' },
    { sub: 'different-owner' },
    { exp: Math.floor(Date.now() / 1000) - 60 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { azp: 'other-client' },
    { aud: [clientId, 'other-client'] },
  ]) {
    await assert.rejects(
      protocol.validateIdentity(await signed(claims), clientId, nonce, subject),
      /could not be verified/
    );
  }
  const missingNonce = new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m');
  await assert.rejects(
    protocol.validateIdentity(await missingNonce.sign(privateKey), clientId, nonce),
    /could not be verified/
  );
});

test('never follows cross-origin discovery endpoints or JWKS metadata', async () => {
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    const saved = metadata[field];
    metadata[field] = 'https://attacker.example/steal';
    await assert.rejects(
      protocol.validateIdentity(await signed(), clientId, nonce),
      /could not be verified/
    );
    assert.ok(requests.every(({ url }) => new URL(url).origin === issuer));
    metadata[field] = saved;
  }
  metadata.issuer = 'https://attacker.example';
  await assert.rejects(
    protocol.validateIdentity(await signed(), clientId, nonce),
    /could not be verified/
  );
});

test('code exchange uses issued client, exact PKCE callback, resource, and granted direct scope', async () => {
  const connected = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  assert.equal(connected.subject, subject);
  assert.equal(connected.session?.refreshToken, 'fixture-refresh');
  const request = requests.find(({ url }) => url === tokenEndpoint)!;
  const form = new URLSearchParams(request.init?.body as URLSearchParams);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('client_id'), clientId);
  assert.equal(form.get('code'), 'fixture-code');
  assert.equal(form.get('redirect_uri'), pending.redirectUri);
  assert.equal(form.get('code_verifier'), pending.verifier);
  assert.equal(form.get('resource'), resource);
  assert.equal(form.has('client_secret'), false);
});

test('callback-advertised scope is insufficient: token response must grant direct plan usage', async () => {
  for (const scope of [
    undefined,
    'openid profile email resource.invoke',
    'chatgpt.tokens.use.directly',
  ]) {
    tokenResponse.scope = scope;
    await assert.rejects(
      protocol.exchangeCode(pending, 'fixture-code', { clientId }),
      /could not be verified/
    );
  }
});

test('new credentials cannot replace a returning registration with a different signed subject', async () => {
  tokenResponse.id_token = await signed({ sub: 'different-owner' });
  await assert.rejects(
    protocol.exchangeCode(pending, 'fixture-code', { clientId, subject }),
    /could not be verified/
  );
});

test('refresh sends no scope, rotates tokens together, and validates renewed identity if present', async () => {
  const prior = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  tokenResponse.access_token = 'fixture-new-access';
  tokenResponse.refresh_token = 'fixture-new-refresh';
  delete tokenResponse.scope;
  const renewed = await protocol.renewRegistration(prior);
  assert.equal(renewed.session?.accessToken, 'fixture-new-access');
  assert.equal(renewed.session?.refreshToken, 'fixture-new-refresh');
  assert.equal(renewed.subject, subject);
  const form = new URLSearchParams(
    requests.filter(({ url }) => url === tokenEndpoint).at(-1)!.init?.body as URLSearchParams
  );
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('client_id'), clientId);
  assert.equal(form.get('refresh_token'), 'fixture-refresh');
  assert.equal(form.get('resource'), resource);
  assert.equal(form.has('scope'), false);
  tokenResponse.id_token = await signed({ sub: 'different-owner' });
  await assert.rejects(protocol.renewRegistration(prior), /renewal failed/);
});

test('refresh may omit unchanged ID/refresh tokens but cannot remove granted direct scope', async () => {
  const prior = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  delete tokenResponse.id_token;
  delete tokenResponse.refresh_token;
  delete tokenResponse.scope;
  const renewed = await protocol.renewRegistration(prior);
  assert.equal(renewed.session?.idToken, prior.session?.idToken);
  assert.equal(renewed.session?.refreshToken, prior.session?.refreshToken);
  tokenResponse.scope = 'openid';
  await assert.rejects(protocol.renewRegistration(prior), /renewal failed/);
});

test('verification-metadata outages are detected before consuming a rotating refresh token', async () => {
  const prior = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  const fixtureFetch = globalThis.fetch;
  for (const failedUrl of [discoveryUrl, jwksUrl]) {
    requests.length = 0;
    globalThis.fetch = async (input, init) =>
      String(input) === failedUrl ? new Response(null, { status: 503 }) : fixtureFetch(input, init);
    await assert.rejects(protocol.renewRegistration(prior), /renewal failed/);
    assert.equal(
      requests.some(({ url }) => url === tokenEndpoint),
      false
    );
  }
});

test('post-rotation ID verification is local and does not lose new tokens to another metadata request', async () => {
  const prior = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  const fixtureFetch = globalThis.fetch;
  tokenResponse.access_token = 'fixture-rotated-access';
  tokenResponse.refresh_token = 'fixture-rotated-refresh';
  tokenResponse.id_token = await signed();
  requests.length = 0;
  let rotated = false;
  globalThis.fetch = async (input, init) => {
    if (rotated) {
      throw new Error('Verification network unavailable after rotation.');
    }
    const response = await fixtureFetch(input, init);
    if (String(input) === tokenEndpoint) {
      rotated = true;
    }
    return response;
  };
  const renewed = await protocol.renewRegistration(prior);
  assert.equal(renewed.session?.refreshToken, 'fixture-rotated-refresh');
  assert.equal(renewed.session?.accessToken, 'fixture-rotated-access');
  assert.deepEqual(
    requests.map(({ url }) => url),
    [discoveryUrl, jwksUrl, tokenEndpoint]
  );
});

test('revocation uses only trusted discovery, sends refresh token/client, and accepts empty 200', async () => {
  const prior = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  assert.equal(await protocol.revokeRegistration(prior), true);
  const revocation = requests.at(-1)!;
  assert.equal(revocation.url, `${issuer}/oauth/revoke`);
  const form = new URLSearchParams(revocation.init?.body as URLSearchParams);
  assert.equal(form.get('token'), 'fixture-refresh');
  assert.equal(form.get('token_type_hint'), 'refresh_token');
  assert.equal(form.get('client_id'), clientId);
  metadata.revocation_endpoint = 'https://attacker.example/steal';
  assert.equal(await protocol.revokeRegistration(prior), false);
  assert.ok(requests.every(({ url }) => new URL(url).origin === issuer));
});

test('unconfirmed revocation retries once on server failure then reports false', async () => {
  const prior: ChatGPTRegistration = {
    clientId,
    subject,
    session: {
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
      idToken: 'fixture-id',
      expiresAt: 1,
      scopes: [],
    },
  };
  revokeStatus = 503;
  assert.equal(await protocol.revokeRegistration(prior), false);
  assert.equal(requests.filter(({ url }) => url.endsWith('/oauth/revoke')).length, 2);
});

test('raw network/provider failures are safe, bounded, and never surfaced', async () => {
  globalThis.fetch = async () => {
    throw new Error('fixture-sensitive-provider-body');
  };
  await assert.rejects(
    protocol.exchangeCode(pending, 'fixture-code', { clientId }),
    (error: Error) => {
      assert.match(error.message, /could not be verified/);
      assert.ok(!error.message.includes('fixture-sensitive'));
      return true;
    }
  );
  globalThis.fetch = async () => new Response('x'.repeat(262_145));
  await assert.rejects(
    protocol.validateIdentity(await signed(), clientId, nonce),
    /could not be verified/
  );
});

test('malformed refresh fields cannot be treated as omitted credentials or an unchanged grant', async () => {
  const prior = await protocol.exchangeCode(pending, 'fixture-code', { clientId });
  for (const field of ['scope', 'id_token', 'refresh_token']) {
    const original = tokenResponse[field];
    tokenResponse[field] = null;
    await assert.rejects(protocol.renewRegistration(prior), /renewal failed/);
    tokenResponse[field] = original;
  }
});
