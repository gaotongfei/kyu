export interface HttpReply {
  data: unknown;
  headers: Headers;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly definitelyUnbilled = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface HttpOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  maxRetryWaitMs?: number;
}

export class ProviderHttp {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly retries: number;
  private readonly maxRetryWaitMs: number;

  constructor(options: HttpOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxBytes = options.maxBytes ?? 8_000_000;
    this.retries = options.retries ?? 2;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 10000;
  }

  async request(url: string, init: RequestInit = {}): Promise<HttpReply> {
    const target = new URL(url);
    const allowed = ['api.hirebase.org', 'api.ashbyhq.com', 'boards-api.greenhouse.io'];
    if (
      target.protocol !== 'https:' ||
      !allowed.includes(target.hostname) ||
      target.port ||
      target.username ||
      target.password ||
      target.hash
    ) {
      throw new ProviderError('Provider target is not allowlisted', null, true);
    }
    const method = init.method ?? 'GET';
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: 'no-store',
        });
      } catch {
        if (method === 'GET' && attempt < this.retries) {
          await this.sleep(Math.min(250 * 2 ** attempt, this.maxRetryWaitMs));
          continue;
        }
        throw new ProviderError('Provider request failed or timed out');
      }
      if (!response.ok) {
        const quota = response.headers.get('x-billing-code') === 'limit_exceeded';
        const retryable =
          !quota && (response.status === 429 || (method === 'GET' && response.status >= 500));
        const retryAfter = response.headers.get('retry-after');
        let delay = 250 * 2 ** attempt;
        if (retryAfter) {
          const seconds = Number(retryAfter);
          delay = Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        await response.body?.cancel();
        if (
          retryable &&
          attempt < this.retries &&
          Number.isFinite(delay) &&
          delay <= this.maxRetryWaitMs
        ) {
          await this.sleep(delay);
          continue;
        }
        throw new ProviderError(
          quota ? 'Provider allowance exhausted' : `Provider returned HTTP ${response.status}`,
          response.status,
          response.status >= 400 && response.status < 500
        );
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError('Provider returned an empty response');
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          bytes += value.byteLength;
          if (bytes > this.maxBytes) {
            throw new ProviderError('Provider response exceeds the size limit');
          }
          chunks.push(value);
        }
        return {
          data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
          headers: response.headers,
        };
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        throw new ProviderError('Provider response is invalid or incomplete JSON');
      } finally {
        await reader.cancel();
      }
    }
  }
}

export async function mapBounded<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error('Provider concurrency must be between 1 and 4');
  }
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) {
          break;
        }
        results[index] = await task(items[index], index);
      }
    })
  );
  return results;
}
