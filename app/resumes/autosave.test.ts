import { Autosave } from './autosave';
import type { Result, Resume } from './model';

const document: Resume = {
  id: 'test-document',
  name: 'Base',
  sections: [],
  themeKey: 'classic',
  version: 1,
  createdAt: '',
  updatedAt: '',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  jest.useRealTimers();
});
it('debounces edits and saves only the latest snapshot', async () => {
  jest.useFakeTimers();
  const write = jest.fn(async (_id, version, input) => ({
    ok: true as const,
    value: { ...document, ...input, version: version + 1 },
  }));
  const queue = new Autosave(document, write);
  queue.edit({ ...document, name: 'One' });
  queue.edit({ ...document, name: 'Two' });
  expect(queue.getSnapshot().status).toBe('pending');
  await jest.advanceTimersByTimeAsync(650);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][2].name).toBe('Two');
  expect(queue.getSnapshot()).toMatchObject({
    dirty: false,
    status: 'saved',
    document: { name: 'Two', version: 2 },
  });
  queue.dispose();
});
it('serializes in-flight edits and flushes them against acknowledged versions', async () => {
  const first = deferred<Result<Resume>>();
  const second = deferred<Result<Resume>>();
  const write = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const queue = new Autosave(document, write);
  queue.edit({ ...document, name: 'First' });
  const flushed = queue.flush();
  queue.edit({ ...document, name: 'Newest' });
  expect(write).toHaveBeenCalledTimes(1);
  first.resolve({ ok: true, value: { ...document, name: 'First', version: 2 } });
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][1]).toBe(2);
  expect(write.mock.calls[1][2].name).toBe('Newest');
  expect(queue.getSnapshot().status).toBe('saving');
  second.resolve({ ok: true, value: { ...document, name: 'Newest', version: 3 } });
  expect((await flushed)?.name).toBe('Newest');
  expect(queue.getSnapshot().dirty).toBe(false);
  queue.dispose();
});
it('failed switching flush retains the document and blocks automatic retries', async () => {
  jest.useFakeTimers();
  const write = jest
    .fn()
    .mockResolvedValue({ ok: false, error: 'Version conflict', conflict: true });
  const queue = new Autosave(document, write);
  queue.edit({ ...document, name: 'Local edit' });
  expect(await queue.flush()).toBeNull();
  queue.edit({ ...document, name: 'Still here' });
  await jest.advanceTimersByTimeAsync(1000);
  expect(await queue.flush()).toBeNull();
  expect(write).toHaveBeenCalledTimes(1);
  expect(queue.getSnapshot()).toMatchObject({
    status: 'error',
    dirty: true,
    document: { name: 'Still here', version: 1 },
  });
  write.mockResolvedValue({ ok: true, value: { ...document, version: 2 } });
  await queue.retry();
  expect(queue.getSnapshot().dirty).toBe(false);
  queue.dispose();
});
it('transport errors preserve edits and never advance versions', async () => {
  const queue = new Autosave(document, async () => {
    throw new Error('offline');
  });
  queue.edit({ ...document, name: 'Offline' });
  expect(await queue.flush()).toBeNull();
  expect(queue.getSnapshot()).toMatchObject({
    dirty: true,
    status: 'error',
    document: { version: 1, name: 'Offline' },
  });
  queue.dispose();
});
