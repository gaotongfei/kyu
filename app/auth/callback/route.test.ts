/** @jest-environment node */
jest.mock('../../../assistance/oauth', () => ({ completeChatGPTSignIn: jest.fn() }));
import { completeChatGPTSignIn } from '../../../assistance/oauth';
import { GET } from './route';

beforeEach(() => jest.clearAllMocks());

test('OAuth completion is private, script-free, and never echoes query secrets', async () => {
  jest.mocked(completeChatGPTSignIn).mockResolvedValue(undefined);
  const response = await GET(
    new Request('http://127.0.0.1:3000/auth/callback?code=private-code&state=private-state', {
      headers: { host: '127.0.0.1:3000' },
    })
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const body = await response.text();
  expect(body).toContain('ChatGPT connected');
  expect(body).not.toMatch(/private-code|private-state|script/i);
});

test('OAuth errors return generic recovery guidance without token/provider details', async () => {
  jest.mocked(completeChatGPTSignIn).mockRejectedValue(new Error('private-token'));
  const response = await GET(
    new Request('http://127.0.0.1:3000/auth/callback?code=private-code', {
      headers: { host: '127.0.0.1:3000' },
    })
  );
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toContain('check AI settings');
  expect(body).not.toMatch(/private-token|private-code/);
});

test('uses the validated incoming loopback Host when Next normalizes its route URL to localhost', async () => {
  jest.mocked(completeChatGPTSignIn).mockResolvedValue(undefined);
  const response = await GET(
    new Request('http://localhost:3000/auth/callback?code=fixture&state=fixture-state', {
      headers: { host: '127.0.0.1:3000' },
    })
  );
  expect(response.status).toBe(200);
  expect(completeChatGPTSignIn).toHaveBeenCalledWith(
    'http://127.0.0.1:3000/auth/callback?code=fixture&state=fixture-state'
  );
});

test.each([
  'localhost:3000',
  'kyu.example',
  '127.0.0.1.attacker.test:3000',
  'user@127.0.0.1:3000',
  '127.0.0.1:99999',
])('rejects invalid callback Host %s before exchange', async (host) => {
  const response = await GET(
    new Request('http://localhost:3000/auth/callback?code=fixture&state=fixture-state', {
      headers: { host },
    })
  );
  expect(response.status).toBe(400);
  expect(completeChatGPTSignIn).not.toHaveBeenCalled();
});
