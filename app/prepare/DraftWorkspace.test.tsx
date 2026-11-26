import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { AiSettings, DraftResult, PreparedJob } from '../../assistance/model';
import { downloadMarkdown } from '../../components/Assistance/download';
import { createDocument, loadLibrary, saveDocument } from '../resumes/actions';
import { loadAiSettings } from '../settings/ai/actions';
import { generateApplicationDrafts } from './actions';
import { DraftWorkspace } from './DraftWorkspace';

jest.mock('./actions', () => ({ generateApplicationDrafts: jest.fn() }));
jest.mock('../resumes/actions', () => ({
  createDocument: jest.fn(),
  loadLibrary: jest.fn(),
  saveDocument: jest.fn(),
}));
jest.mock('../settings/ai/actions', () => ({ loadAiSettings: jest.fn() }));
jest.mock('../../components/Assistance/download', () => ({ downloadMarkdown: jest.fn() }));

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const library = [
  { id, name: 'Original resume', version: 2 },
  { id: secondId, name: 'Second resume', version: 3 },
];
const job: PreparedJob = {
  source: 'ashby:fixture',
  sourceJobId: 'fixture-job',
  title: 'Fixture engineer',
  company: 'Fixture employer',
  descriptionText: 'Build accessible TypeScript applications.',
  descriptionComplete: true,
  active: true,
  lastObservedAt: '2026-11-26T12:00:00Z',
};
const generated: DraftResult = {
  drafts: {
    resumeMarkdown: '# Tailored candidate\nSupported experience.\n',
    coverLetterMarkdown: 'Dear fixture team,\n',
  },
  resumeName: 'Original resume',
  sourceResumeId: id,
  sourceResumeVersion: 2,
  provider: 'openai',
  model: 'gpt-5.4-mini',
};
function settings(): AiSettings {
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
function show(overrides: Partial<Parameters<typeof DraftWorkspace>[0]> = {}) {
  return render(
    <MantineProvider>
      <DraftWorkspace
        job={job}
        initialLibrary={library}
        initialSettings={settings()}
        localChatGPT
        {...overrides}
      />
    </MantineProvider>
  );
}
async function generate() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
  await screen.findByRole('textbox', { name: 'Tailored resume' });
}
function leaving() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(generateApplicationDrafts).mockResolvedValue({ ok: true, value: generated });
  jest.mocked(createDocument).mockImplementation(async (input) => ({
    ok: true,
    value: {
      ...input,
      id: '33333333-3333-4333-8333-333333333333',
      version: 1,
      createdAt: '2026-11-26T12:00:00Z',
      updatedAt: '2026-11-26T12:00:00Z',
    },
  }));
  jest.mocked(loadLibrary).mockResolvedValue({ ok: true, value: library });
  jest.mocked(loadAiSettings).mockResolvedValue({ ok: true, value: settings() });
});

test('mounts and changes source choices without calling AI, persistence, or model discovery', () => {
  show();
  fireEvent.change(screen.getByLabelText('Source resume'), { target: { value: secondId } });
  expect(generateApplicationDrafts).not.toHaveBeenCalled();
  expect(createDocument).not.toHaveBeenCalled();
  expect(loadAiSettings).not.toHaveBeenCalled();
  expect(loadLibrary).not.toHaveBeenCalled();
  expect(leaving()).toBe(false);
});

test('explicit generation uses the visible saved source version and selected connection', async () => {
  show();
  fireEvent.change(screen.getByLabelText('Source resume'), { target: { value: secondId } });
  await generate();
  expect(generateApplicationDrafts).toHaveBeenCalledTimes(1);
  expect(generateApplicationDrafts).toHaveBeenCalledWith({
    source: job.source,
    sourceJobId: job.sourceJobId,
    resumeId: secondId,
    resumeVersion: 3,
    connection: { provider: 'openai', model: 'gpt-5.4-mini' },
  });
  expect(screen.getByRole('textbox', { name: 'Tailored resume' })).toHaveValue(
    generated.drafts.resumeMarkdown
  );
  expect(screen.getByRole('textbox', { name: 'Cover letter' })).toHaveValue(
    generated.drafts.coverLetterMarkdown
  );
  expect(createDocument).not.toHaveBeenCalled();
  expect(saveDocument).not.toHaveBeenCalled();
});

test('pending requests disable inputs and guard repeated paid clicks and leaving', async () => {
  let finish: (value: Awaited<ReturnType<typeof generateApplicationDrafts>>) => void = () => {};
  jest.mocked(generateApplicationDrafts).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
  expect(screen.getByLabelText('Source resume')).toBeDisabled();
  expect(leaving()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Generate drafts/ }));
  expect(generateApplicationDrafts).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ ok: true, value: generated });
  });
});

test('edits are saved only as a new resume, without an original ID or update call', async () => {
  show();
  await generate();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tailored resume' }), {
    target: { value: '# Reviewed draft\nExact edits.\n' },
  });
  fireEvent.change(screen.getByLabelText('New resume name'), {
    target: { value: 'Reviewed copy' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save as new resume' }));
  await screen.findByLabelText('New resume saved');
  expect(createDocument).toHaveBeenCalledWith({
    name: 'Reviewed copy',
    contentMarkdown: '# Reviewed draft\nExact edits.\n',
    themeKey: 'classic',
  });
  expect(saveDocument).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Open saved resume ↗' })).toHaveAttribute(
    'target',
    '_blank'
  );
  expect(screen.getByRole('button', { name: 'Save as new resume' })).toBeDisabled();
});

test('leaving remains guarded until both documents are saved or downloaded; edits re-arm it', async () => {
  show();
  await generate();
  expect(leaving()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save as new resume' }));
  await screen.findByLabelText('New resume saved');
  expect(leaving()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Download cover letter .md' }));
  expect(downloadMarkdown).toHaveBeenCalledWith(
    generated.drafts.coverLetterMarkdown,
    expect.stringContaining('cover letter')
  );
  expect(leaving()).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: 'Cover letter' }), {
    target: { value: 'Reviewed letter' },
  });
  expect(leaving()).toBe(true);
});

test('downloads exact edited Markdown without browser persistence or source writes', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem');
  show();
  await generate();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tailored resume' }), {
    target: { value: '# Edited\n  - Exact spaces  \n' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Download resume .md' }));
  expect(downloadMarkdown).toHaveBeenCalledWith(
    '# Edited\n  - Exact spaces  \n',
    expect.any(String)
  );
  expect(storage).not.toHaveBeenCalled();
  expect(createDocument).not.toHaveBeenCalled();
  expect(saveDocument).not.toHaveBeenCalled();
  storage.mockRestore();
});

test('regeneration requires confirmation and failures preserve edited drafts', async () => {
  show();
  await generate();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tailored resume' }), {
    target: { value: 'Keep these edits' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
  expect(screen.getByRole('dialog', { name: 'Replace drafts?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(generateApplicationDrafts).toHaveBeenCalledTimes(1);
  jest
    .mocked(generateApplicationDrafts)
    .mockResolvedValue({ ok: false, error: 'Provider usage limit reached.' });
  fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate new drafts' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Tailored resume' })).toHaveValue('Keep these edits');
  expect(screen.getByRole('textbox', { name: 'Cover letter' })).toHaveValue(
    generated.drafts.coverLetterMarkdown
  );
  expect(generateApplicationDrafts).toHaveBeenCalledTimes(2);
});

test('navigation confirms discarding drafts and Cancel keeps them in place', async () => {
  show();
  await generate();
  fireEvent.click(screen.getByRole('link', { name: 'AI settings' }));
  expect(screen.getByRole('dialog', { name: 'Leave drafts?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('textbox', { name: 'Tailored resume' })).toHaveValue(
    generated.drafts.resumeMarkdown
  );
});

test('save and refresh failures retain editable drafts and their downloads', async () => {
  show();
  await generate();
  jest.mocked(createDocument).mockResolvedValue({ ok: false, error: 'Storage unavailable.' });
  fireEvent.click(screen.getByRole('button', { name: 'Save as new resume' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Download resume .md' })).toBeEnabled();
  jest.mocked(loadAiSettings).mockResolvedValue({ ok: false, error: 'Could not load settings.' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh settings' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load settings.')
  );
  expect(screen.getByRole('textbox', { name: 'Tailored resume' })).toHaveValue(
    generated.drafts.resumeMarkdown
  );
});

test('no source, missing description, or no connection disables generation with recovery', () => {
  const view = show({ initialLibrary: [] });
  expect(screen.getByRole('button', { name: 'Generate drafts' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Create or import a resume' })).toBeInTheDocument();
  view.unmount();
  const next = show({ job: { ...job, descriptionText: null } });
  expect(screen.getByRole('button', { name: 'Generate drafts' })).toBeDisabled();
  next.unmount();
  show({ initialSettings: { ...settings(), activeProvider: null } });
  expect(screen.getByRole('button', { name: 'Generate drafts' })).toBeDisabled();
  expect(generateApplicationDrafts).not.toHaveBeenCalled();
});

test('a server visit never silently switches a local ChatGPT selection to paid API use', () => {
  const selected = settings();
  selected.activeProvider = 'chatgpt';
  selected.connections.chatgpt = {
    connected: true,
    model: 'fixture-plan-model',
    models: [{ id: 'fixture-plan-model', name: 'Fixture' }],
  };
  show({ initialSettings: selected, localChatGPT: false });
  expect(screen.getByRole('button', { name: 'Generate drafts' })).toBeDisabled();
  expect(screen.getByText(/Choose an API-key connection for this server/)).toBeInTheDocument();
  expect(generateApplicationDrafts).not.toHaveBeenCalled();
});

test('generated HTML is source text, never executable markup', async () => {
  jest.mocked(generateApplicationDrafts).mockResolvedValue({
    ok: true,
    value: {
      ...generated,
      drafts: {
        ...generated.drafts,
        resumeMarkdown: '<img src="https://example.test/pixel">\n<script>run()</script>',
      },
    },
  });
  const { container } = show();
  await generate();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Tailored resume' })).toHaveValue(
    '<img src="https://example.test/pixel">\n<script>run()</script>'
  );
});
