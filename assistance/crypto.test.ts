/** @jest-environment node */
jest.mock('server-only', () => ({}));

import { randomBytes } from 'node:crypto';
import { encryptionKey, requireEncryptionKey, seal, unseal } from './crypto';

const originalKey = process.env.KYU_AI_ENCRYPTION_KEY;
afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.KYU_AI_ENCRYPTION_KEY;
  } else {
    process.env.KYU_AI_ENCRYPTION_KEY = originalKey;
  }
});

test('requires canonical base64 for exactly 32 bytes, without echoing invalid configuration', () => {
  delete process.env.KYU_AI_ENCRYPTION_KEY;
  expect(encryptionKey()).toBeNull();
  expect(() => requireEncryptionKey()).toThrow('32-byte');
  for (const invalid of [
    'never-echo-my-config',
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
  ]) {
    process.env.KYU_AI_ENCRYPTION_KEY = invalid;
    expect(() => encryptionKey()).toThrow(
      /^Set KYU_AI_ENCRYPTION_KEY to a base64-encoded 32-byte server key\.$/
    );
  }
  process.env.KYU_AI_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  expect(encryptionKey()).toEqual(Buffer.alloc(32));
});

test('versioned authenticated envelopes contain no plaintext and use a fresh nonce', () => {
  const key = randomBytes(32);
  const fixture = { key: 'fixture-secret-do-not-expose' };
  const first = seal(fixture, key, 'openai');
  const second = seal(fixture, key, 'openai');
  expect(first).toMatch(/^v1\./);
  expect(first).not.toEqual(second);
  expect(first).not.toContain(fixture.key);
  expect(unseal(first, key, 'openai')).toEqual(fixture);
});

test('rejects tampering, wrong keys, slot substitution, and unknown envelope versions', () => {
  const key = randomBytes(32);
  const envelope = seal({ key: 'fixture-secret' }, key, 'openai');
  const parts = envelope.split('.');
  for (const index of [1, 2, 3]) {
    const changed = [...parts];
    changed[index] = `${changed[index][0] === 'A' ? 'B' : 'A'}${changed[index].slice(1)}`;
    expect(() => unseal(changed.join('.'), key, 'openai')).toThrow('not changed');
  }
  expect(() => unseal(envelope, randomBytes(32), 'openai')).toThrow('original');
  expect(() => unseal(envelope, key, 'openrouter')).toThrow('original');
  expect(() => unseal(envelope.replace('v1.', 'v2.'), key, 'openai')).toThrow('original');
});
