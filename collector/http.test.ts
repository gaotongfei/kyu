/** @jest-environment node */
import { mapBounded, ProviderHttp } from './http';

const url = 'https://api.hirebase.org/v2/jobs/search';
const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers });

test('rejects arbitrary hosts, credentials, ports and redirects', async () => {
  const fetcher = jest.fn();
  const http = new ProviderHttp({ fetch: fetcher });
  for (const target of [
    'http://api.hirebase.org/x',
    'https://evil.test',
    'https://api.hirebase.org:444/x',
    'https://key@api.hirebase.org/x',
  ]) {
    await expect(http.request(target)).rejects.toThrow('allowlisted');
  }
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(reply({}, 302));
  await expect(http.request(url)).rejects.toThrow('302');
  expect(fetcher).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ redirect: 'error', cache: 'no-store' })
  );
});

test('retries safe requests and rate limits, respecting bounded Retry-After', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(reply({}, 503))
    .mockResolvedValueOnce(reply({}, 429, { 'Retry-After': '1' }))
    .mockResolvedValue(reply({ jobs: [] }));
  const sleep = jest.fn().mockResolvedValue(undefined);
  const http = new ProviderHttp({ fetch: fetcher, sleep });
  await expect(http.request(url)).resolves.toMatchObject({ data: { jobs: [] } });
  expect(sleep.mock.calls).toEqual([[250], [1000]]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test('does not retry quota failures, long waits or ambiguous POSTs', async () => {
  for (const response of [
    reply({}, 429, { 'X-Billing-Code': 'limit_exceeded' }),
    reply({}, 429, { 'Retry-After': '3600' }),
    reply({}, 500),
  ]) {
    const fetcher = jest.fn().mockResolvedValue(response);
    await expect(
      new ProviderHttp({ fetch: fetcher }).request(url, { method: 'POST' })
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher = jest.fn().mockRejectedValue(new Error('contains secret'));
  await expect(
    new ProviderHttp({ fetch: fetcher }).request(url, { method: 'POST' })
  ).rejects.toThrow('failed or timed out');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('enforces retry, response-size and valid-JSON bounds', async () => {
  const fetcher = jest.fn().mockResolvedValue(reply({}, 500));
  await expect(
    new ProviderHttp({ fetch: fetcher, sleep: async () => {} }).request(url)
  ).rejects.toThrow('500');
  expect(fetcher).toHaveBeenCalledTimes(3);
  await expect(
    new ProviderHttp({
      fetch: jest.fn().mockResolvedValue(reply({ payload: 'large' })),
      maxBytes: 3,
    }).request(url)
  ).rejects.toThrow('size limit');
  await expect(
    new ProviderHttp({ fetch: jest.fn().mockResolvedValue(new Response('{bad')) }).request(url)
  ).rejects.toThrow('invalid');
});

test('bounds concurrent workers while preserving order', async () => {
  let active = 0;
  let maximum = 0;
  const values = await mapBounded([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active -= 1;
    return value * 2;
  });
  expect(maximum).toBe(2);
  expect(values).toEqual([2, 4, 6, 8, 10]);
  await expect(mapBounded([], 5, async () => 0)).rejects.toThrow();
});
