import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { AiSettings } from '../../../assistance/model';
import {
  beginChatGPTSignIn,
  connectAiProvider,
  loadAiSettings,
  refreshAiModels,
  removeAiConnection,
  saveAiSelection,
} from './actions';
import { AiSettingsForm } from './SettingsForm';

jest.mock('./actions', () => ({
  beginChatGPTSignIn: jest.fn(),
  cancelAiSignIn: jest.fn(),
  connectAiProvider: jest.fn(),
  loadAiSettings: jest.fn(),
  refreshAiModels: jest.fn(),
  removeAiConnection: jest.fn(),
  saveAiSelection: jest.fn(),
}));

function fixture(): AiSettings {
  return {
    encryptionConfigured: true,
    activeProvider: 'openai',
    connections: {
      openai: {
        connected: true,
        model: 'gpt-5.4-mini',
        models: [{ id: 'gpt-5.4-mini', name: 'Mini' }],
      },
      openrouter: { connected: false, model: null, models: [] },
      chatgpt: { connected: false, model: null, models: [] },
    },
    signIn: { pending: false, error: null },
  };
}
function show(settings = fixture(), localChatGPT = true) {
  return render(
    <MantineProvider>
      <AiSettingsForm
        initialSettings={settings}
        localChatGPT={localChatGPT}
        returnHref="/prepare?source=fixture&job=id"
        settingsHref="/settings/ai"
      />
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadAiSettings).mockResolvedValue({ ok: true, value: fixture() });
  jest.mocked(saveAiSelection).mockResolvedValue({ ok: true, value: fixture() });
});
afterEach(() => jest.useRealTimers());

test('mounting displays cached choices without provider connections, discovery, or generation', () => {
  show();
  expect(screen.getByLabelText('Model')).toHaveValue('gpt-5.4-mini');
  expect(loadAiSettings).not.toHaveBeenCalled();
  expect(refreshAiModels).not.toHaveBeenCalled();
  expect(connectAiProvider).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Replace API key')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Replace API key')).toHaveValue('');
});

test('model IDs are not repeated when a catalog has no separate display name', () => {
  const settings = fixture();
  settings.connections.openai.models = [{ id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' }];
  show(settings);
  expect(screen.getByRole('option', { name: 'gpt-5.4-mini' })).toHaveTextContent(/^gpt-5\.4-mini$/);
});

test('a key is sent only on connect, then cleared; no browser persistence or provider fallback', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem');
  jest
    .mocked(connectAiProvider)
    .mockResolvedValue({ ok: false, error: 'The key was not accepted. Enter it again.' });
  show();
  fireEvent.change(screen.getByLabelText('Replace API key'), {
    target: { value: 'fixture-secret-key' },
  });
  expect(connectAiProvider).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
  await screen.findByRole('alert');
  expect(connectAiProvider).toHaveBeenCalledWith('openai', 'fixture-secret-key');
  expect(screen.getByLabelText('Replace API key')).toHaveValue('');
  expect(storage).not.toHaveBeenCalled();
  expect(saveAiSelection).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Connection')).toHaveValue('openai');
  storage.mockRestore();
});

test('connection and model choices are persisted only on explicit Save selection', async () => {
  const settings = fixture();
  settings.connections.openrouter = {
    connected: true,
    model: null,
    models: [{ id: 'fixture/model', name: 'Fixture model' }],
  };
  show(settings);
  fireEvent.change(screen.getByLabelText('Connection'), { target: { value: 'openrouter' } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'fixture/model' } });
  expect(saveAiSelection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
  await waitFor(() => expect(saveAiSelection).toHaveBeenCalledWith('openrouter', 'fixture/model'));
});

test('missing installation encryption has actionable setup and no enabled secret submission', () => {
  show({ ...fixture(), encryptionConfigured: false });
  expect(screen.getByRole('heading', { name: 'Configure encryption' })).toBeInTheDocument();
  expect(screen.getByText(/KYU_AI_ENCRYPTION_KEY/)).toBeInTheDocument();
  expect(
    screen
      .getAllByRole('button', { name: 'Connect' })
      .every((button) => button.hasAttribute('disabled'))
  ).toBe(true);
});

test('server installations keep API keys usable but do not offer ChatGPT sign-in', () => {
  show(fixture(), false);
  expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeDisabled();
  expect(screen.getByLabelText('Replace API key')).toBeEnabled();
  expect(screen.getByText(/Use an API-key connection on this server/)).toBeInTheDocument();
});

test('ChatGPT sign-in explicitly exposes an authorization link and polls only safe state', async () => {
  const settings = fixture();
  const pending = { ...settings, signIn: { pending: true, error: null } };
  jest.mocked(beginChatGPTSignIn).mockResolvedValue({
    ok: true,
    value: { url: 'https://auth.openai.com/api/accounts/authorize?state=fixture' },
  });
  jest.mocked(loadAiSettings).mockResolvedValue({ ok: true, value: pending });
  show(settings);
  expect(beginChatGPTSignIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
  const link = await screen.findByRole('link', { name: 'Open ChatGPT sign-in ↗' });
  expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  expect(link).toHaveAttribute('href', expect.stringContaining('https://auth.openai.com/'));
  expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeEnabled();
});

test('pending sign-in polls state without triggering model refresh or another sign-in', async () => {
  jest.useFakeTimers();
  const settings = fixture();
  settings.signIn.pending = true;
  const connected = fixture();
  connected.connections.chatgpt = {
    connected: true,
    model: null,
    models: [],
    accountLabel: 'fixture@example.test',
  };
  jest.mocked(loadAiSettings).mockResolvedValue({ ok: true, value: connected });
  show(settings);
  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  expect(screen.getByLabelText('ChatGPT connected')).toBeInTheDocument();
  expect(beginChatGPTSignIn).not.toHaveBeenCalled();
  expect(refreshAiModels).not.toHaveBeenCalled();
});

test('removing a connection requires an accessible confirmation', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
  expect(screen.getByRole('dialog', { name: 'Remove connection' })).toBeInTheDocument();
  expect(removeAiConnection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  jest.mocked(removeAiConnection).mockResolvedValue({ ok: true, value: fixture() });
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
  await waitFor(() => expect(removeAiConnection).toHaveBeenCalledWith('openai'));
});
