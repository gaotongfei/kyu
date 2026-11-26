/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('../../../assistance/settings', () => ({
  connectApiKey: jest.fn(),
  readSettings: jest.fn(),
  refreshModels: jest.fn(),
  removeConnection: jest.fn(),
  selectConnection: jest.fn(),
}));
jest.mock('../../../assistance/oauth', () => ({
  cancelChatGPTSignIn: jest.fn(),
  startChatGPTSignIn: jest.fn(),
}));
jest.mock('../../../assistance/origin', () => ({ requestOrigin: jest.fn() }));
import { requestOrigin } from '../../../assistance/origin';
import { connectApiKey, refreshModels, selectConnection } from '../../../assistance/settings';
import { connectAiProvider, refreshAiModels, saveAiSelection } from './actions';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requestOrigin).mockResolvedValue('https://private-server.example');
});

test('server installs cannot activate or refresh a local subscription connection', async () => {
  expect(await saveAiSelection('chatgpt', 'fixture-model')).toMatchObject({
    ok: false,
    error: expect.stringContaining('same-computer'),
  });
  expect(await refreshAiModels('chatgpt')).toMatchObject({
    ok: false,
    error: expect.stringContaining('same-computer'),
  });
  expect(refreshModels).not.toHaveBeenCalled();
  expect(selectConnection).not.toHaveBeenCalled();
});

test('OpenAI and OpenRouter connection actions work independently of install location', async () => {
  jest.mocked(connectApiKey).mockRejectedValue(new Error('SQL password=not-for-browser'));
  const result = await connectAiProvider('openrouter', 'fixture-key');
  expect(connectApiKey).toHaveBeenCalledWith('openrouter', 'fixture-key');
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/SQL|not-for-browser/);
});
