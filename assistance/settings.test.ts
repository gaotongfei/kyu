/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('../db', () => ({ getDb: jest.fn() }));
jest.mock('./providers', () => ({ listProviderModels: jest.fn() }));
jest.mock('./chatgpt', () => ({
  authorizeEndpoint: 'https://auth.openai.com/api/accounts/authorize',
  resource: 'https://api.openai.com/v1',
  directScope: 'chatgpt.tokens.use.direct',
  exchangeCode: jest.fn(),
  renewRegistration: jest.fn(),
  revokeRegistration: jest.fn(),
}));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getDb } from '../db';
import type { aiSettings } from '../db/schema';
import { exchangeCode, renewRegistration, revokeRegistration } from './chatgpt';
import { requireEncryptionKey } from './crypto';
import { AiError } from './model';
import { cancelChatGPTSignIn, completeChatGPTSignIn, startChatGPTSignIn } from './oauth';
import { listProviderModels } from './providers';
import {
  connectApiKey,
  readSettings,
  refreshModels,
  removeConnection,
  resolveGenerationConnection,
  selectConnection,
} from './settings';
import {
  SettingsStore,
  withSettings,
  type ChatGPTRegistration,
  type PendingSignIn,
} from './storage';

type Row = typeof aiSettings.$inferSelect;
let persisted: Row | undefined;
let queue: Promise<unknown>;
let locked: boolean;
const lockQuery = jest.fn();
const rowLock = jest.fn();
const writes = jest.fn();
const originalKey = process.env.KYU_AI_ENCRYPTION_KEY;
const models = [
  { id: 'gpt-5.4-mini', name: 'GPT fixture' },
  { id: 'other-model', name: 'Other fixture' },
];
const selected = { provider: 'chatgpt' as const, model: 'gpt-5.4-mini' };
const registration = (): ChatGPTRegistration => ({
  clientId: 'oaiapp_fixture',
  subject: 'fixture-subject',
  email: 'owner@example.test',
  session: {
    accessToken: 'fixture-access-secret',
    refreshToken: 'fixture-refresh-secret',
    idToken: 'fixture-id-secret',
    expiresAt: Date.now() - 1,
    scopes: ['chatgpt.tokens.use.direct'],
  },
});

function store(): SettingsStore {
  return new SettingsStore(requireEncryptionKey(), persisted);
}

const fakeDb = {
  select: () => ({
    from: () => ({ where: async () => (persisted ? [structuredClone(persisted)] : []) }),
  }),
  transaction: jest.fn(async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    // Database fixture simulates transaction isolation; production must request both locks.
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    let next = persisted ? structuredClone(persisted) : undefined;
    locked = false;
    try {
      const result = await work({
        execute: async (query: unknown) => {
          lockQuery(query);
          locked = true;
        },
        select: () => ({
          from: () => ({
            where: () => ({
              for: async (mode: string) => {
                assert.equal(locked, true);
                rowLock(mode);
                return next ? [structuredClone(next)] : [];
              },
            }),
          }),
        }),
        insert: () => ({
          values: (row: Row) => ({
            onConflictDoUpdate: async () => {
              assert.equal(locked, true);
              writes(row);
              next = structuredClone(row);
            },
          }),
        }),
      });
      persisted = next;
      return result;
    } finally {
      locked = false;
      release();
    }
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  persisted = undefined;
  queue = Promise.resolve();
  process.env.KYU_AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  jest.mocked(getDb).mockReturnValue(fakeDb as never);
  jest.mocked(listProviderModels).mockResolvedValue(models);
  jest.mocked(revokeRegistration).mockResolvedValue(true);
  jest.mocked(renewRegistration).mockImplementation(async (old) => {
    assert.equal(locked, true, 'The database lock must cover the entire renewal');
    await Promise.resolve();
    return {
      ...old,
      session: {
        ...old.session!,
        accessToken: 'rotated-access-secret',
        refreshToken: 'rotated-refresh-secret',
        expiresAt: Date.now() + 3_600_000,
      },
    };
  });
  jest.mocked(exchangeCode).mockImplementation(async (_pending, _code, prior) => ({
    ...registration(),
    clientId: prior.clientId,
    session: { ...registration().session!, expiresAt: Date.now() + 3_600_000 },
  }));
});
afterAll(() => {
  if (originalKey === undefined) {
    delete process.env.KYU_AI_ENCRYPTION_KEY;
  } else {
    process.env.KYU_AI_ENCRYPTION_KEY = originalKey;
  }
});

async function seedChatGPT(): Promise<void> {
  await withSettings(async (state) => {
    state.set('chatgpt', registration());
    state.document.connections.chatgpt = { connected: true, model: selected.model, models };
    state.document.activeProvider = 'chatgpt';
  });
}

async function start(): Promise<{ callback: URL; pending: PendingSignIn }> {
  const { url } = await startChatGPTSignIn('http://localhost:3000');
  const pending = store().get<PendingSignIn>('pending')!;
  const callback = new URL(new URL(url).searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    state: pending.state,
    code: 'fixture-code',
    client_id: 'oaiapp_fixture',
  }).toString();
  return { callback, pending };
}

test('settings/OAuth imports and missing-key reads do not initialize a DB or contact a provider', async () => {
  jest.isolateModules(() => {
    require('./settings');
    require('./oauth');
  });
  expect(getDb).not.toHaveBeenCalled();
  delete process.env.KYU_AI_ENCRYPTION_KEY;
  expect(await readSettings()).toMatchObject({
    encryptionConfigured: false,
    activeProvider: null,
    signIn: { pending: false },
  });
  expect(getDb).not.toHaveBeenCalled();
  expect(listProviderModels).not.toHaveBeenCalled();
  expect(renewRegistration).not.toHaveBeenCalled();
});

test('ordinary reads are safe projections with no renewal, discovery, or provider requests', async () => {
  await seedChatGPT();
  await start();
  const result = await readSettings();
  expect(result.signIn.pending).toBe(true);
  expect(result.connections.chatgpt.connected).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/secret|verifier|nonce|state|clientId|subject|hostId/);
  expect(JSON.stringify(persisted)).not.toMatch(/fixture-(access|refresh|id)-secret/);
  expect(renewRegistration).not.toHaveBeenCalled();
  expect(exchangeCode).not.toHaveBeenCalled();
  expect(listProviderModels).not.toHaveBeenCalled();
});

test('connect lists models explicitly, defaults only when listed, and never switches active billing', async () => {
  const connected = await connectApiKey('openai', 'fixture-openai-key');
  expect(listProviderModels).toHaveBeenCalledWith({
    provider: 'openai',
    token: 'fixture-openai-key',
  });
  expect(connected.activeProvider).toBeNull();
  expect(connected.connections.openai.model).toBe('gpt-5.4-mini');
  await selectConnection('openai', 'gpt-5.4-mini');
  jest.mocked(listProviderModels).mockResolvedValue([{ id: 'only-model', name: 'Only fixture' }]);
  const other = await connectApiKey('openrouter', 'fixture-router-key');
  expect(other.activeProvider).toBe('openai');
  expect(other.connections.openrouter.model).toBeNull();
  expect(JSON.stringify(other)).not.toContain('fixture-openai-key');
  expect(JSON.stringify(persisted)).not.toContain('fixture-router-key');
  const removed = await removeConnection('openai');
  expect(removed.activeProvider).toBeNull();
  expect(removed.connections.openrouter.connected).toBe(true);
  expect(store().get('openai')).toBeUndefined();
  expect(lockQuery).toHaveBeenCalled();
  expect(rowLock).toHaveBeenCalledWith('update');
});

test('key bounds and cached selections are validated without external requests', async () => {
  for (const key of ['', 'short', 'a'.repeat(4097), 'fixture key', '☃'.repeat(12)]) {
    await expect(connectApiKey('openai', key)).rejects.toBeInstanceOf(AiError);
  }
  await expect(selectConnection('openai', 'gpt-5.4-mini')).rejects.toThrow('cached catalog');
  expect(listProviderModels).not.toHaveBeenCalled();
});

test('a disappeared selected model clears selection rather than silently choosing another', async () => {
  await connectApiKey('openai', 'fixture-openai-key');
  await selectConnection('openai', 'other-model');
  jest.mocked(listProviderModels).mockResolvedValue([models[0]]);
  const result = await refreshModels('openai');
  expect(result.activeProvider).toBeNull();
  expect(result.connections.openai.model).toBeNull();
});

test('missing/wrong keys and damaged envelopes never replace saved credentials', async () => {
  await connectApiKey('openai', 'fixture-openai-key');
  const before = structuredClone(persisted);
  jest.mocked(listProviderModels).mockClear();
  delete process.env.KYU_AI_ENCRYPTION_KEY;
  await expect(removeConnection('openai')).rejects.toThrow('32-byte');
  expect(persisted).toEqual(before);
  process.env.KYU_AI_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  await expect(readSettings()).rejects.toThrow('original');
  await expect(connectApiKey('openai', 'replacement-fixture')).rejects.toThrow('not changed');
  expect(persisted).toEqual(before);
  process.env.KYU_AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  persisted!.credentials.openai = 'v1.broken';
  await expect(connectApiKey('openai', 'replacement-fixture')).rejects.toThrow('not changed');
  await expect(removeConnection('openai')).rejects.toThrow('not changed');
  expect(listProviderModels).not.toHaveBeenCalled();
});

test('changed provider/model is rejected before decrypting a credential or renewing tokens', async () => {
  await seedChatGPT();
  persisted!.credentials.chatgpt = 'v1.broken';
  await expect(resolveGenerationConnection({ ...selected, model: 'other-model' })).rejects.toThrow(
    'changed'
  );
  await expect(
    resolveGenerationConnection({ provider: 'openai', model: selected.model })
  ).rejects.toThrow('changed');
  expect(renewRegistration).not.toHaveBeenCalled();
  expect(listProviderModels).not.toHaveBeenCalled();
});

test('concurrent generation resolution renews once under the DB lock and persists rotated tokens together', async () => {
  await seedChatGPT();
  const results = await Promise.all([
    resolveGenerationConnection(selected),
    resolveGenerationConnection(selected),
  ]);
  expect(results.map((result) => result.token)).toEqual([
    'rotated-access-secret',
    'rotated-access-secret',
  ]);
  expect(renewRegistration).toHaveBeenCalledTimes(1);
  expect(store().get<ChatGPTRegistration>('chatgpt')!.session!.refreshToken).toBe(
    'rotated-refresh-secret'
  );
  expect(lockQuery).toHaveBeenCalledTimes(3);
  expect(listProviderModels).not.toHaveBeenCalled();
});

test('catalog failure after renewal still commits the latest rotating token', async () => {
  await seedChatGPT();
  jest.mocked(listProviderModels).mockRejectedValue(new Error('raw-provider-secret'));
  await expect(refreshModels('chatgpt')).rejects.toThrow('Models could not be refreshed');
  expect(store().get<ChatGPTRegistration>('chatgpt')!.session!.refreshToken).toBe(
    'rotated-refresh-secret'
  );
  await resolveGenerationConnection(selected);
  expect(renewRegistration).toHaveBeenCalledTimes(1);
});

test.each([
  'https://localhost:3000',
  'http://remote.example:3000',
  'http://127.0.0.1.evil.test:3000',
  'http://localhost:3000/path',
  'http://user@localhost:3000',
  'http://localhost:3000?x=1',
])('rejects non-local HTTP origin %s', async (origin) => {
  await expect(startChatGPTSignIn(origin)).rejects.toThrow('same-computer');
  expect(getDb).not.toHaveBeenCalled();
});

test.each(['http://127.0.0.1:3456', 'http://localhost:3456', 'http://[::1]:3456'])(
  'uses loopback127 on the same port with fresh PKCE/state/nonce and a stable host (%s)',
  async (origin) => {
    const first = new URL((await startChatGPTSignIn(origin)).url);
    const pending = store().get<PendingSignIn>('pending')!;
    expect(first.origin).toBe('https://auth.openai.com');
    expect(first.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3456/auth/callback');
    expect(first.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(first.searchParams.get('agent_name_hint')).toBe('Kyu');
    expect(first.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(pending.verifier).digest('base64url')
    );
    expect(first.searchParams.get('nonce')).toBe(pending.nonce);
    expect(first.searchParams.get('state')).toBe(pending.state);
    expect(JSON.stringify(persisted)).not.toContain(pending.verifier);
    const second = new URL((await startChatGPTSignIn(origin)).url);
    expect(second.searchParams.get('ext_agent_host_id')).toBe(
      first.searchParams.get('ext_agent_host_id')
    );
    expect(second.searchParams.get('state')).not.toBe(pending.state);
    expect(second.searchParams.get('nonce')).not.toBe(pending.nonce);
  }
);

test('callback saves issued client before exchange, connects only after validation, and cannot be replayed', async () => {
  const { callback, pending } = await start();
  jest.mocked(exchangeCode).mockImplementationOnce(async (_attempt, _code, prior) => {
    expect(store().get<ChatGPTRegistration>('chatgpt')!.clientId).toBe('oaiapp_fixture');
    expect(store().get<PendingSignIn>('pending')!.phase).toBe('exchanging');
    expect(persisted!.settings.connections.chatgpt.connected).toBe(false);
    return { ...registration(), clientId: prior.clientId };
  });
  await completeChatGPTSignIn(callback.href);
  expect(exchangeCode).toHaveBeenCalledWith(pending, 'fixture-code', {
    clientId: 'oaiapp_fixture',
  });
  const result = await readSettings();
  expect(result.connections.chatgpt).toMatchObject({
    connected: true,
    model: 'gpt-5.4-mini',
    accountLabel: 'owner@example.test',
  });
  expect(result.activeProvider).toBeNull();
  expect(result.signIn).toEqual({ pending: false, error: null });
  await expect(completeChatGPTSignIn(callback.href)).rejects.toThrow('already used');
  expect(exchangeCode).toHaveBeenCalledTimes(1);
});

test('failed exchange consumes callback and retains issued registration for routine reauthorization', async () => {
  const { callback } = await start();
  jest.mocked(exchangeCode).mockRejectedValueOnce(new Error('raw-secret-invalid-grant'));
  await expect(completeChatGPTSignIn(callback.href)).rejects.toThrow('could not be verified');
  expect((await readSettings()).signIn).toMatchObject({
    pending: false,
    error: expect.not.stringContaining('raw-secret'),
  });
  expect(store().get<ChatGPTRegistration>('chatgpt')).toEqual({ clientId: 'oaiapp_fixture' });
  const reauth = new URL((await startChatGPTSignIn('http://localhost:3000')).url);
  expect(reauth.searchParams.get('client_id')).toBe('oaiapp_fixture');
  expect(reauth.searchParams.has('agent_name_hint')).toBe(false);
  expect(reauth.searchParams.has('id_token_hint')).toBe(false);
});

test('wrong state, callback host/path/protocol/port, and duplicate parameters cannot exchange a code', async () => {
  const { callback } = await start();
  for (const changed of [
    callback.href.replace('127.0.0.1', 'localhost'),
    callback.href.replace('http:', 'https:'),
    callback.href.replace(':3000', ':3001'),
    callback.href.replace('/auth/callback', '/callback'),
    `${callback.href}&state=duplicate`,
    callback.href.replace(/state=[^&]+/, 'state=wrong'),
  ]) {
    await expect(completeChatGPTSignIn(changed)).rejects.toThrow('invalid');
  }
  expect(exchangeCode).not.toHaveBeenCalled();
  expect((await readSettings()).signIn.pending).toBe(true);
});

test('expiry, denial, and cancellation are safe, one-time failures without token requests', async () => {
  let attempt = await start();
  await withSettings(async (state) => {
    state.set('pending', { ...attempt.pending, expiresAt: Date.now() - 1 });
  });
  expect((await readSettings()).signIn).toMatchObject({
    pending: false,
    error: expect.stringContaining('expired'),
  });
  await expect(completeChatGPTSignIn(attempt.callback.href)).rejects.toThrow('expired');
  attempt = await start();
  attempt.callback.searchParams.set('error', 'access_denied');
  attempt.callback.searchParams.set('error_description', 'raw-provider-secret');
  await expect(completeChatGPTSignIn(attempt.callback.href)).rejects.toThrow('plan access');
  expect(JSON.stringify(await readSettings())).not.toContain('raw-provider-secret');
  attempt = await start();
  expect((await cancelChatGPTSignIn()).signIn).toEqual({ pending: false, error: null });
  await expect(completeChatGPTSignIn(attempt.callback.href)).rejects.toThrow('already used');
  expect(exchangeCode).not.toHaveBeenCalled();
});

test('returning callbacks cannot replace the registered client or mix identities', async () => {
  await seedChatGPT();
  const { callback } = await start();
  callback.searchParams.set('client_id', 'oaiapp_different');
  await expect(completeChatGPTSignIn(callback.href)).rejects.toThrow('changed');
  expect(store().get<ChatGPTRegistration>('chatgpt')!.subject).toBe('fixture-subject');
  expect(exchangeCode).not.toHaveBeenCalled();
});

test('disconnect attempts revocation, erases all tokens, retains host/identity/client, and warns safely on failure', async () => {
  await seedChatGPT();
  const host = store().hostId;
  jest.mocked(revokeRegistration).mockResolvedValue(false);
  const result = await removeConnection('chatgpt');
  expect(revokeRegistration).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: 'oaiapp_fixture' })
  );
  expect(result.activeProvider).toBeNull();
  expect(result.connections.chatgpt.connected).toBe(false);
  expect(result.signIn.error).toContain('Remote revocation was not confirmed');
  expect(store().get<ChatGPTRegistration>('chatgpt')).toEqual({
    clientId: 'oaiapp_fixture',
    subject: 'fixture-subject',
    email: 'owner@example.test',
  });
  expect(store().hostId).toBe(host);
});

test('SQL failures are never exposed in actionable errors', async () => {
  jest.mocked(getDb).mockImplementationOnce(() => {
    throw new Error('postgres://password-secret SQL SELECT');
  });
  await expect(readSettings()).rejects.toThrow('settings are unavailable');
});

test('concurrent callbacks exchange a one-time code only once', async () => {
  const { callback } = await start();
  const results = await Promise.allSettled([
    completeChatGPTSignIn(callback.href),
    completeChatGPTSignIn(callback.href),
  ]);
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(exchangeCode).toHaveBeenCalledTimes(1);
  expect((await readSettings()).connections.chatgpt.connected).toBe(true);
});

test('returning callbacks may omit the client ID and must retain the verified identity binding', async () => {
  await seedChatGPT();
  const { callback } = await start();
  callback.searchParams.delete('client_id');
  await completeChatGPTSignIn(callback.href);
  expect(exchangeCode).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: 'oaiapp_fixture' }),
    'fixture-code',
    expect.objectContaining({ clientId: 'oaiapp_fixture', subject: 'fixture-subject' })
  );
  expect((await readSettings()).activeProvider).toBe('chatgpt');
});

test('catalog failure after successful OAuth retains the verified session for an explicit model refresh', async () => {
  const { callback } = await start();
  jest.mocked(listProviderModels).mockRejectedValueOnce(new Error('raw-catalog-secret'));
  await expect(completeChatGPTSignIn(callback.href)).rejects.toThrow('Refresh models');
  const result = await readSettings();
  expect(result.connections.chatgpt.connected).toBe(true);
  expect(result.signIn).toEqual({
    pending: false,
    error: 'ChatGPT connected. Refresh models to choose a model.',
  });
  expect(store().get<ChatGPTRegistration>('chatgpt')!.session).toBeDefined();
  expect(JSON.stringify(persisted)).not.toContain('fixture-code');
  expect(JSON.stringify(result)).not.toContain('raw-catalog-secret');
  await refreshModels('chatgpt');
  expect((await readSettings()).connections.chatgpt.models).toEqual(models);
});

test.each([null, 'dynamic_agent_client', 'invalid client'])(
  'initial registration rejects missing or invalid issued client %s',
  async (client) => {
    const { callback } = await start();
    if (client === null) {
      callback.searchParams.delete('client_id');
    } else {
      callback.searchParams.set('client_id', client);
    }
    await expect(completeChatGPTSignIn(callback.href)).rejects.toThrow('incomplete');
    expect(exchangeCode).not.toHaveBeenCalled();
    expect((await readSettings()).signIn.pending).toBe(false);
  }
);
