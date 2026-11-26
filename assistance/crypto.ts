import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import 'server-only';
import { AiError } from './model';

const keyError = 'Set KYU_AI_ENCRYPTION_KEY to a base64-encoded 32-byte server key.';
const lostKeyError =
  'AI credentials could not be unlocked. Restore the original KYU_AI_ENCRYPTION_KEY; saved credentials were not changed.';

export function encryptionKey(): Buffer | null {
  const value = process.env.KYU_AI_ENCRYPTION_KEY;
  if (!value) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new AiError(keyError);
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new AiError(keyError);
  }
  return key;
}

export function requireEncryptionKey(): Buffer {
  const key = encryptionKey();
  if (!key) {
    throw new AiError(keyError);
  }
  return key;
}

// Version and purpose are authenticated, so envelopes cannot be moved between slots.
export function seal(value: unknown, key: Buffer, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`kyu-ai-settings:v1:${purpose}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

export function unseal<T>(envelope: string, key: Buffer, purpose: string): T {
  try {
    const parts = envelope.split('.');
    if (
      parts.length !== 4 ||
      parts[0] !== 'v1' ||
      parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    ) {
      throw new Error('Invalid envelope');
    }
    const [, nonce, payload, auth] = parts;
    if (
      parts.slice(1).some((part) => Buffer.from(part, 'base64url').toString('base64url') !== part)
    ) {
      throw new Error('Invalid envelope');
    }
    const iv = Buffer.from(nonce, 'base64url');
    const tag = Buffer.from(auth, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) {
      throw new Error('Invalid envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`kyu-ai-settings:v1:${purpose}`, 'utf8'));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(payload, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    ) as T;
  } catch {
    throw new AiError(lostKeyError);
  }
}
