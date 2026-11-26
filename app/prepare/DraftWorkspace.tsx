'use client';

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { aiSettingsHref } from '../../assistance/links';
import {
  providerNames,
  type AiSettings,
  type DraftResult,
  type PreparedJob,
  type SelectedConnection,
} from '../../assistance/model';
import { ConfirmDialog } from '../../components/Assistance/ConfirmDialog';
import { downloadMarkdown } from '../../components/Assistance/download';
import { StatusIcon } from '../../components/Assistance/StatusIcon';
import { SiteHeader } from '../../components/SiteHeader/SiteHeader';
import { createDocument, loadLibrary } from '../resumes/actions';
import { validateInput, type ResumeSummary } from '../resumes/model';
import { loadAiSettings } from '../settings/ai/actions';
import { generateApplicationDrafts } from './actions';
import styles from '../../components/Assistance/Assistance.module.css';

type Props = {
  job: PreparedJob | null;
  initialLibrary: ResumeSummary[];
  initialSettings: AiSettings | null;
  initialError?: string;
  localChatGPT: boolean;
};
type Confirmation = { kind: 'regenerate' } | { kind: 'navigate'; href: string } | null;
type SavedCopy = { id: string; name: string; source: string };

function draftName(resumeName: string, company: string): string {
  let name = '';
  for (const character of `${resumeName} — ${company}`) {
    if (name.length + character.length > 120) {
      break;
    }
    name += character;
  }
  return name;
}

export function DraftWorkspace({
  job,
  initialLibrary,
  initialSettings,
  initialError,
  localChatGPT,
}: Props) {
  const [library, setLibrary] = useState(initialLibrary);
  const [settings, setSettings] = useState(initialSettings);
  const [resumeId, setResumeId] = useState(initialLibrary[0]?.id ?? '');
  const [result, setResult] = useState<DraftResult | null>(null);
  const [resumeMarkdown, setResumeMarkdown] = useState('');
  const [coverLetterMarkdown, setCoverLetterMarkdown] = useState('');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<SavedCopy | null>(null);
  const [resumeDownload, setResumeDownload] = useState<{ source: string; name: string } | null>(
    null
  );
  const [letterDownload, setLetterDownload] = useState<string | null>(null);
  const [error, setError] = useState(initialError ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const allowNavigation = useRef(false);

  const sourceResume = library.find((resume) => resume.id === resumeId);
  const provider = settings?.activeProvider ?? null;
  const connection = provider ? settings?.connections[provider] : null;
  const selected: SelectedConnection | null =
    provider && connection?.connected && connection.model
      ? { provider, model: connection.model }
      : null;
  const remoteSubscription = selected?.provider === 'chatgpt' && !localChatGPT;
  const savedCurrent = saved?.source === resumeMarkdown && saved.name === name;
  const downloadedCurrent =
    resumeDownload?.source === resumeMarkdown && resumeDownload.name === name;
  const unsaved = Boolean(
    result && ((!savedCurrent && !downloadedCurrent) || letterDownload !== coverLetterMarkdown)
  );
  const needsProtection = unsaved || busy === 'Generating drafts';
  const canGenerate = Boolean(
    job?.descriptionText?.trim() && sourceResume && selected && !remoteSubscription && !busy
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (needsProtection && !allowNavigation.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [needsProtection]);

  function guardNavigation(event: MouseEvent<HTMLDivElement>) {
    if (
      !needsProtection ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.target === '_blank' ||
      anchor.hasAttribute('download')
    ) {
      return;
    }
    event.preventDefault();
    setConfirmation({ kind: 'navigate', href: anchor.href });
  }

  async function generate() {
    if (busyRef.current || !job || !sourceResume || !selected || remoteSubscription) {
      return;
    }
    busyRef.current = true;
    setBusy('Generating drafts');
    setError('');
    try {
      const response = await generateApplicationDrafts({
        source: job.source,
        sourceJobId: job.sourceJobId,
        resumeId: sourceResume.id,
        resumeVersion: sourceResume.version,
        connection: selected,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.value);
      setResumeMarkdown(response.value.drafts.resumeMarkdown);
      setCoverLetterMarkdown(response.value.drafts.coverLetterMarkdown);
      setName(draftName(response.value.resumeName, job.company));
      setSaved(null);
      setResumeDownload(null);
      setLetterDownload(null);
    } catch {
      setError(
        'Generation could not be completed. Your current drafts are still here. Check AI settings before retrying.'
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function requestGeneration(event: FormEvent) {
    event.preventDefault();
    if (!canGenerate || busyRef.current) {
      return;
    }
    if (unsaved) {
      setConfirmation({ kind: 'regenerate' });
    } else {
      void generate();
    }
  }

  async function saveResume(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || !result || savedCurrent) {
      return;
    }
    busyRef.current = true;
    setBusy('Saving new resume');
    setError('');
    try {
      const input = validateInput({ name, contentMarkdown: resumeMarkdown, themeKey: 'classic' });
      const response = await createDocument(input);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setName(response.value.name);
      setSaved({ id: response.value.id, name: response.value.name, source: resumeMarkdown });
    } catch {
      setError(
        'The new resume could not be saved. Your draft is still here; retry or download it.'
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function download(kind: 'resume' | 'letter') {
    try {
      downloadMarkdown(
        kind === 'resume' ? resumeMarkdown : coverLetterMarkdown,
        kind === 'resume' ? name : `${name} — cover letter`
      );
      if (kind === 'resume') {
        setResumeDownload({ source: resumeMarkdown, name });
      } else {
        setLetterDownload(coverLetterMarkdown);
      }
    } catch {
      setError('The draft could not be downloaded. Keep this page open and check the draft text.');
    }
  }

  async function refresh(kind: 'resumes' | 'settings') {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(kind === 'resumes' ? 'Refreshing resumes' : 'Refreshing settings');
    setError('');
    try {
      if (kind === 'resumes') {
        const response = await loadLibrary();
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setLibrary(response.value);
        if (!response.value.some((resume) => resume.id === resumeId)) {
          setResumeId('');
        }
      } else {
        const response = await loadAiSettings();
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setSettings(response.value);
      }
    } catch {
      setError('The selection could not be refreshed. Your current drafts are still here.');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div className={styles.canvas} onClickCapture={guardNavigation}>
      <div className={styles.frame}>
        <SiteHeader activePage="jobs" />
        <main className={styles.main}>
          <div className={styles.headingRow}>
            <a href="/jobs" className={styles.link}>
              ← Discover
            </a>
            <a href={aiSettingsHref(job?.source, job?.sourceJobId)} className={styles.link}>
              AI settings
            </a>
          </div>
          <h1 className={styles.heading}>{job?.title ?? 'Application drafts'}</h1>
          {job && <p className={styles.muted}>{job.company}</p>}
          {job && !job.active && (
            <p className={styles.warning}>
              This listing is inactive. Check the original posting before applying.
            </p>
          )}
          {job && !job.descriptionComplete && (
            <p className={styles.warning}>The collected description may be incomplete.</p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {job && (
            <>
              <details className={styles.details}>
                <summary>Job description</summary>
                <p className={styles.description}>
                  {job.descriptionText ?? 'Description not reported.'}
                </p>
              </details>
              <form className={styles.setup} onSubmit={requestGeneration}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor="source-resume" className={styles.label}>
                      Source resume
                    </label>
                    <select
                      id="source-resume"
                      className={styles.select}
                      value={resumeId}
                      disabled={Boolean(busy) || library.length === 0}
                      required
                      onChange={(event) => setResumeId(event.target.value)}
                    >
                      <option value="">Choose a resume</option>
                      {library.map((resume) => (
                        <option key={resume.id} value={resume.id}>
                          {resume.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={Boolean(busy)}
                    onClick={() => void refresh('resumes')}
                  >
                    Refresh resumes
                  </button>
                  <button
                    type="submit"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={!canGenerate}
                  >
                    {busy === 'Generating drafts' && (
                      <StatusIcon kind="busy" label="Generating drafts" />
                    )}
                    Generate drafts
                  </button>
                </div>
                {library.length === 0 && (
                  <p className={styles.warning}>
                    <a
                      href="/resumes"
                      target="_blank"
                      rel="noreferrer noopener"
                      className={styles.link}
                    >
                      Create or import a resume
                    </a>
                    , then refresh the resume list.
                  </p>
                )}
                {!job.descriptionText?.trim() && (
                  <p className={styles.warning}>
                    No job description was collected. Choose another job from Discover.
                  </p>
                )}
                {!selected && (
                  <p className={styles.warning}>
                    Choose a connection and model in{' '}
                    <a href={aiSettingsHref(job.source, job.sourceJobId)} className={styles.link}>
                      AI settings
                    </a>
                    .
                  </p>
                )}
                {remoteSubscription && (
                  <p className={styles.warning}>
                    The selected ChatGPT connection requires a supported same-computer install.
                    Choose an API-key connection for this server.
                  </p>
                )}
                {selected && (
                  <p className={styles.notice}>
                    Generating sends the selected saved resume and this job description to{' '}
                    {selected.provider === 'openrouter'
                      ? 'OpenRouter and its model provider'
                      : selected.provider === 'chatgpt'
                        ? 'OpenAI using your ChatGPT plan'
                        : 'OpenAI'}
                    .{' '}
                    {selected.provider === 'chatgpt'
                      ? 'It uses your plan allowance.'
                      : 'Usage charges apply.'}
                  </p>
                )}
                <div className={styles.actions} style={{ marginTop: 'var(--kyu-space-3)' }}>
                  {selected && (
                    <span className={styles.muted}>
                      {providerNames[selected.provider]} · {selected.model}
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.button}
                    disabled={Boolean(busy)}
                    onClick={() => void refresh('settings')}
                  >
                    Refresh settings
                  </button>
                  {selected?.provider === 'chatgpt' && (
                    <a
                      href="https://chatgpt.com/settings/usage"
                      target="_blank"
                      rel="noreferrer noopener"
                      className={styles.link}
                    >
                      Manage usage ↗
                    </a>
                  )}
                </div>
              </form>
            </>
          )}
          {result && (
            <>
              <div className={styles.review}>
                <div className={styles.headingRow}>
                  <h2 className={styles.subheading}>Review drafts</h2>
                  {busy && busy !== 'Generating drafts' && <StatusIcon kind="busy" label={busy} />}
                </div>
                <p className={styles.notice}>
                  Source: {result.resumeName} · version {result.sourceResumeVersion} ·{' '}
                  {providerNames[result.provider]} · {result.model}
                </p>
                <p className={styles.warning}>Check every claim before using these drafts.</p>
              </div>
              <div className={styles.grid}>
                <form className={styles.draft} onSubmit={saveResume}>
                  <h2>
                    <label htmlFor="tailored-resume">Tailored resume</label>
                  </h2>
                  <textarea
                    id="tailored-resume"
                    className={styles.textarea}
                    value={resumeMarkdown}
                    disabled={Boolean(busy)}
                    maxLength={500_000}
                    spellCheck={false}
                    onChange={(event) => setResumeMarkdown(event.target.value)}
                  />
                  <div>
                    <label htmlFor="draft-name" className={styles.label}>
                      New resume name
                    </label>
                    <input
                      id="draft-name"
                      className={styles.input}
                      value={name}
                      maxLength={120}
                      required
                      disabled={Boolean(busy)}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="submit"
                      className={`${styles.button} ${styles.primary}`}
                      disabled={Boolean(busy) || !name.trim() || savedCurrent}
                    >
                      Save as new resume
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={Boolean(busy)}
                      onClick={() => download('resume')}
                    >
                      Download resume .md
                    </button>
                    {savedCurrent && <StatusIcon kind="check" label="New resume saved" />}
                  </div>
                  {saved && (
                    <a
                      href={`/resumes?resume=${encodeURIComponent(saved.id)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={styles.link}
                    >
                      Open saved resume ↗
                    </a>
                  )}
                </form>
                <section className={styles.draft}>
                  <h2>
                    <label htmlFor="cover-letter">Cover letter</label>
                  </h2>
                  <textarea
                    id="cover-letter"
                    className={styles.textarea}
                    value={coverLetterMarkdown}
                    disabled={Boolean(busy)}
                    maxLength={500_000}
                    spellCheck={false}
                    onChange={(event) => setCoverLetterMarkdown(event.target.value)}
                  />
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.primary}`}
                      disabled={Boolean(busy)}
                      onClick={() => download('letter')}
                    >
                      Download cover letter .md
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
      <ConfirmDialog
        opened={confirmation !== null}
        title={confirmation?.kind === 'regenerate' ? 'Replace drafts?' : 'Leave drafts?'}
        confirmLabel={confirmation?.kind === 'regenerate' ? 'Generate new drafts' : 'Leave page'}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const confirmed = confirmation;
          setConfirmation(null);
          if (confirmed?.kind === 'regenerate') {
            void generate();
          } else if (confirmed?.kind === 'navigate') {
            allowNavigation.current = true;
            window.location.assign(confirmed.href);
            window.setTimeout(() => {
              allowNavigation.current = false;
            }, 0);
          }
        }}
      >
        <p>
          {confirmation?.kind === 'regenerate'
            ? 'New results will replace your current drafts. Save or download anything you want to keep first.'
            : 'Leaving discards unsaved drafts or a pending response. Save or download what you need first; a pending generation may still use provider allowance.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}
