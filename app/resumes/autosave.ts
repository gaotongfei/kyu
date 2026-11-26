import type { Result, Resume, ResumeInput } from './model';

type Write = (id: string, version: number, input: ResumeInput) => Promise<Result<Resume>>;
type Snapshot = {
  document: Resume;
  status: 'saved' | 'pending' | 'saving' | 'error';
  dirty: boolean;
  error: string | null;
};

/**
 * Each instance manages autosaving for one open document, with one write at a time.
 * Edits are coalesced into the latest snapshot, not queued individually.
 * Each write uses the last acknowledged version, never an optimistic version.
 */
export class Autosave {
  private snapshot: Snapshot;
  private revision = 0;
  private savedRevision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<Resume | null>;
  private listeners = new Set<() => void>();

  constructor(
    document: Resume,
    private write: Write,
    private delay = 650
  ) {
    this.snapshot = { document, status: 'saved', dirty: false, error: null };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(update: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) {
      listener();
    }
  }

  edit(input: ResumeInput) {
    this.revision += 1;
    this.publish({
      document: { ...this.snapshot.document, ...input },
      dirty: true,
      status: this.snapshot.error ? 'error' : this.flight ? 'saving' : 'pending',
    });
    clearTimeout(this.timer);
    if (!this.snapshot.error) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.delay);
    }
  }

  flush(): Promise<Resume | null> {
    clearTimeout(this.timer);
    if (this.flight) {
      return this.flight;
    }
    if (this.snapshot.error) {
      return Promise.resolve(null);
    }
    if (!this.snapshot.dirty) {
      return Promise.resolve(this.snapshot.document);
    }
    this.flight = this.drain().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }

  async retry() {
    this.publish({ error: null });
    return this.flush();
  }

  private async drain(): Promise<Resume | null> {
    while (this.savedRevision !== this.revision) {
      const revision = this.revision;
      const { document } = this.snapshot;
      this.publish({ status: 'saving' });
      let result: Result<Resume>;
      try {
        result = await this.write(document.id, document.version, document);
      } catch {
        result = {
          ok: false,
          error: 'Saving failed. Your edits are still here. Check the connection and retry.',
        };
      }
      if (!result.ok) {
        this.publish({ status: 'error', error: result.error, dirty: true });
        return null;
      }
      this.savedRevision = revision;
      const latest = this.snapshot.document;
      this.publish({
        document: { ...latest, version: result.value.version, updatedAt: result.value.updatedAt },
        dirty: this.savedRevision !== this.revision,
        status: this.savedRevision === this.revision ? 'saved' : 'saving',
      });
    }
    return this.snapshot.document;
  }

  dispose() {
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
