import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import 'server-only';
import { getDb } from '../db';
import { aiSettings } from '../db/schema';
import { encryptionKey, requireEncryptionKey, seal, unseal } from './crypto';
import { AiError, aiProviders, type AiSettings } from './model';

export type SettingsDocument = Omit<AiSettings, 'encryptionConfigured'>;
export type CredentialSlot = 'openai' | 'openrouter' | 'chatgpt' | 'pending';
export type EncryptedCredentials = Partial<Record<CredentialSlot, string>>;
export type PendingSignIn = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  clientId: string | null;
  phase: 'waiting' | 'exchanging';
};
export type ChatGPTRegistration = {
  clientId: string;
  subject?: string;
  email?: string;
  session?: {
    accessToken: string;
    refreshToken: string;
    idToken: string;
    expiresAt: number;
    scopes: string[];
  };
};

type StoredRow = typeof aiSettings.$inferSelect;

function emptySettings(): AiSettings {
  return {
    encryptionConfigured: false,
    activeProvider: null,
    connections: {
      openai: { connected: false, model: null, models: [] },
      openrouter: { connected: false, model: null, models: [] },
      chatgpt: { connected: false, model: null, models: [] },
    },
    signIn: { pending: false, error: null },
  };
}

export class SettingsStore {
  readonly hostId: string;
  readonly document: SettingsDocument;
  private readonly credentials: EncryptedCredentials;
  private readonly keyCheck: string;
  private dirty = false;

  constructor(
    private readonly key: Buffer,
    row?: StoredRow
  ) {
    if (row && unseal(row.keyCheck, key, 'key-check') !== 'kyu-ai-settings') {
      throw new AiError(
        'AI credentials could not be unlocked. Restore the original server encryption key.'
      );
    }
    this.hostId = row?.hostId ?? randomUUID();
    this.document = structuredClone(row?.settings ?? emptySettings());
    this.credentials = { ...row?.credentials };
    this.keyCheck = row?.keyCheck ?? seal('kyu-ai-settings', key, 'key-check');
  }

  get<T>(slot: CredentialSlot): T | undefined {
    const envelope = this.credentials[slot];
    return envelope === undefined ? undefined : unseal<T>(envelope, this.key, slot);
  }

  set(slot: CredentialSlot, value: unknown | undefined): void {
    // In particular, reconnect/remove must never replace an unreadable credential.
    this.get(slot);
    if (value === undefined) {
      delete this.credentials[slot];
    } else {
      this.credentials[slot] = seal(value, this.key, slot);
    }
    this.touch();
  }

  touch(): void {
    this.dirty = true;
  }

  publicSettings(): AiSettings {
    // Explicit projection: never spread persisted JSON or credential records to the browser.
    const result = emptySettings();
    result.encryptionConfigured = true;
    result.activeProvider = this.document.activeProvider;
    for (const provider of aiProviders) {
      const connection = this.document.connections[provider];
      result.connections[provider] = {
        connected: connection.connected,
        model: connection.model,
        models: connection.models.map(({ id, name }) => ({ id, name })),
        ...(connection.accountLabel ? { accountLabel: connection.accountLabel } : {}),
      };
    }
    const pending = this.get<PendingSignIn>('pending');
    result.signIn = {
      pending: !!pending && pending.expiresAt > Date.now(),
      error:
        pending && pending.expiresAt <= Date.now()
          ? 'ChatGPT sign-in expired. Try again.'
          : this.document.signIn.error,
    };
    return result;
  }

  row(): StoredRow | null {
    if (!this.dirty) {
      return null;
    }
    return {
      id: 1,
      hostId: this.hostId,
      settings: this.document,
      credentials: this.credentials,
      keyCheck: this.keyCheck,
      updatedAt: new Date(),
    };
  }
}

function storageError(error: unknown): never {
  if (error instanceof AiError) {
    throw error;
  }
  throw new AiError(
    'AI settings are unavailable. Check the server database configuration and migrations.'
  );
}

export async function readStoredSettings(): Promise<AiSettings> {
  const key = encryptionKey();
  if (!key) {
    return emptySettings();
  }
  try {
    const [row] = await getDb().select().from(aiSettings).where(eq(aiSettings.id, 1));
    return new SettingsStore(key, row).publicSettings();
  } catch (error) {
    return storageError(error);
  }
}

export async function withSettings<T>(work: (store: SettingsStore) => Promise<T>): Promise<T> {
  const key = requireEncryptionKey();
  try {
    return await getDb().transaction(async (tx) => {
      // Covers the initially absent row too. Every writer/renewal uses this same database lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1264145749, 1)`);
      const [row] = await tx.select().from(aiSettings).where(eq(aiSettings.id, 1)).for('update');
      const store = new SettingsStore(key, row);
      const value = await work(store);
      const next = store.row();
      if (next) {
        await tx
          .insert(aiSettings)
          .values(next)
          .onConflictDoUpdate({ target: aiSettings.id, set: next });
      }
      return value;
    });
  } catch (error) {
    return storageError(error);
  }
}
