'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { Menu, Modal } from '@mantine/core';
import { SiteHeader } from '../../components/SiteHeader/SiteHeader';
import { createDocument, deleteDocument, loadDocument, loadLibrary, saveDocument } from './actions';
import { Autosave } from './autosave';
import { fileName } from './markdown';
import { MarkdownPreview } from './MarkdownPreview';
import {
  validateInput,
  type Result,
  type Resume,
  type ResumeInput,
  type ResumeSummary,
} from './model';
import styles from './editor.module.css';

type EditorProps = {
  initialLibrary: ResumeSummary[];
  initialDocument: Resume | null;
  initialError?: string;
};
type ImportDraft = ResumeInput & { warnings: string[]; kind: 'md' | 'pdf' };
type Dialog = 'new' | 'rename' | 'delete' | 'import' | null;
type IconName = 'chevron' | 'more' | 'check';

function Icon({ name }: { name: IconName }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'chevron' && <path d="m6 9 6 6 6-6" />}
      {name === 'check' && <path d="m5 12 4 4L19 6" />}
      {name === 'more' && (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      )}
    </svg>
  );
}

const menuClasses = {
  dropdown: styles.menuDropdown,
  item: styles.menuItem,
  itemLabel: styles.menuItemLabel,
  label: styles.menuLabel,
  divider: styles.menuDivider,
};
const modalClasses = {
  content: styles.modalContent,
  header: styles.modalHeader,
  title: styles.modalTitle,
  body: styles.modalBody,
  close: styles.modalClose,
};

class OperationError extends Error {}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new OperationError(result.error);
  }
  return result.value;
}

async function responseError(response: Response, fallback: string) {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // A proxy or unavailable server may return a non-JSON error page.
  }
  return fallback;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Leave time for the browser to start reading the download before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function parseDraft(value: unknown): ImportDraft {
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    (value.kind !== 'md' && value.kind !== 'pdf') ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('contentMarkdown' in value) ||
    typeof value.contentMarkdown !== 'string' ||
    !('warnings' in value) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new OperationError('The import response was incomplete. Please choose the file again.');
  }
  try {
    const input = validateInput({
      name: value.name,
      contentMarkdown: value.contentMarkdown,
      themeKey: 'classic',
    });
    return { ...input, warnings: value.warnings, kind: value.kind };
  } catch {
    throw new OperationError('The imported draft was invalid. No resume has been created.');
  }
}

function LibraryMenu({
  library,
  document,
  busy,
  titleRef,
  onSwitch,
  onNew,
  onImport,
}: {
  library: ResumeSummary[];
  document: Resume | null;
  busy: boolean;
  titleRef: RefObject<HTMLButtonElement | null>;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
}) {
  return (
    <h1 className={styles.heading}>
      <Menu
        position="bottom-start"
        width="min(18rem, calc(100vw - 2rem))"
        classNames={menuClasses}
        transitionProps={{ duration: 0 }}
      >
        <Menu.Target>
          <button
            ref={titleRef}
            type="button"
            className={styles.titleTrigger}
            disabled={busy}
            aria-label={`${document?.name ?? 'Resumes'} — choose a resume`}
          >
            <span>{document?.name ?? 'Resumes'}</span>
            <Icon name="chevron" />
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Your resumes</Menu.Label>
          {library.length === 0 && <Menu.Label>No resumes yet</Menu.Label>}
          {library.map((resume) => (
            <Menu.Item
              key={resume.id}
              data-current={resume.id === document?.id || undefined}
              rightSection={resume.id === document?.id ? <Icon name="check" /> : undefined}
              onClick={() => onSwitch(resume.id)}
              disabled={busy}
              aria-label={`${resume.name}${resume.id === document?.id ? ' (current resume)' : ''}`}
            >
              {resume.name}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item onClick={onNew} disabled={busy}>
            New resume
          </Menu.Item>
          <Menu.Item onClick={onImport} disabled={busy}>
            Import .md / .pdf
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </h1>
  );
}

export function Editor({ initialLibrary, initialDocument, initialError }: EditorProps) {
  const [library, setLibrary] = useState(initialLibrary);
  const [queue, setQueue] = useState(() =>
    initialDocument ? new Autosave(initialDocument, saveDocument) : null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const dialogReturnRef = useRef<HTMLButtonElement | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState(initialError ?? null);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);

  useEffect(() => () => queue?.dispose(), [queue]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue?.getSnapshot().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [queue]);

  const acknowledge = useCallback((document: Resume) => {
    setLibrary((current) => {
      const summary = { id: document.id, name: document.name, version: document.version };
      const previous = current.find((item) => item.id === document.id);
      if (previous?.version === summary.version && previous.name === summary.name) {
        return current;
      }
      return previous
        ? current.map((item) => (item.id === document.id ? summary : item))
        : [summary, ...current];
    });
  }, []);

  const isLocked = () => busyRef.current;

  async function perform(label: string, operation: () => Promise<void>) {
    if (busyRef.current) {
      return;
    }
    // The synchronous guard also blocks input events before React paints disabled fields.
    busyRef.current = true;
    setBusy(label);
    setOperationError(null);
    setModalError(null);
    setNotice('');
    try {
      await operation();
    } catch (error) {
      const message =
        error instanceof OperationError
          ? error.message
          : 'The operation could not finish. Your current resume and edits are still here. Please retry.';
      setOperationError(message);
      setModalError(message);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function flushCurrent() {
    if (!queue) {
      return null;
    }
    const saved = await queue.flush();
    if (!saved) {
      throw new OperationError(
        queue.getSnapshot().error ?? 'Saving failed. Your edits are still here. Retry saving first.'
      );
    }
    acknowledge(saved);
    return saved;
  }

  function openDocument(document: Resume | null) {
    const url = new URL(window.location.href);
    if (document) {
      url.searchParams.set('resume', document.id);
    } else {
      url.searchParams.delete('resume');
    }
    window.history.replaceState(null, '', url);
    setAvailabilityError(null);
    if (document) {
      acknowledge(document);
    }
    setQueue(document ? new Autosave(document, saveDocument) : null);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function switchDocument(id: string) {
    perform('Saving before switching…', async () => {
      await flushCurrent();
      if (queue?.getSnapshot().document.id !== id) {
        openDocument(unwrap(await loadDocument(id)));
      } else {
        requestAnimationFrame(() => titleRef.current?.focus());
      }
    });
  }

  function openDialog(next: Exclude<Dialog, null>) {
    if (busyRef.current) {
      return;
    }
    dialogReturnRef.current =
      next === 'rename' || next === 'delete' ? overflowRef.current : titleRef.current;
    perform('Preparing resume…', async () => {
      // Opening New or Import never abandons the current queue, even on failure.
      if (next === 'new' || next === 'import') {
        await flushCurrent();
      }
      setName(next === 'rename' ? (queue?.getSnapshot().document.name ?? '') : '');
      setDraft(null);
      setImportFile(null);
      setDialog(next);
    });
  }

  function closeDialog() {
    if (!busyRef.current) {
      setDialog(null);
      setDraft(null);
      setImportFile(null);
      setModalError(null);
      requestAnimationFrame(() => dialogReturnRef.current?.focus());
    }
  }

  function refresh() {
    perform('Connecting to resume storage…', async () => {
      await flushCurrent();
      const nextLibrary = unwrap(await loadLibrary());
      const document =
        !queue && nextLibrary[0] ? unwrap(await loadDocument(nextLibrary[0].id)) : null;
      setLibrary(nextLibrary);
      if (document) {
        openDocument(document);
      }
      setAvailabilityError(null);
      setNotice('Resume library refreshed.');
    });
  }

  function createResume(input: ResumeInput) {
    perform('Saving and creating resume…', async () => {
      await flushCurrent();
      const created = unwrap(await createDocument(input));
      openDocument(created);
      setDialog(null);
      setDraft(null);
      setImportFile(null);
      setNotice('Resume created.');
    });
  }

  function renameResume() {
    perform('Saving resume name…', async () => {
      const saved = await flushCurrent();
      if (!saved || !queue) {
        return;
      }
      queue.edit({ ...saved, name: name.trim() });
      const renamed = await queue.flush();
      if (!renamed) {
        throw new OperationError(queue.getSnapshot().error ?? 'The name could not be saved.');
      }
      acknowledge(renamed);
      setDialog(null);
      setNotice('Resume renamed.');
      requestAnimationFrame(() => overflowRef.current?.focus());
    });
  }

  function removeResume() {
    perform('Saving before deleting…', async () => {
      const saved = await flushCurrent();
      if (!saved) {
        return;
      }
      const next = library.find((item) => item.id !== saved.id);
      // Load the next document first so a failed switch does not strand a deleted document onscreen.
      const nextDocument = next ? unwrap(await loadDocument(next.id)) : null;
      unwrap(await deleteDocument(saved.id, saved.version));
      setLibrary((current) => current.filter((item) => item.id !== saved.id));
      openDocument(nextDocument);
      setDialog(null);
      setNotice('Resume deleted.');
    });
  }

  function importResume() {
    if (!importFile) {
      setModalError('Choose a .md or selectable-text .pdf file first.');
      return;
    }
    const file = importFile;
    perform('Reading import for review…', async () => {
      await flushCurrent();
      if (file.size > 10 * 1024 * 1024) {
        throw new OperationError('Files must be 10 MiB or smaller.');
      }
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/resumes/import', {
        method: 'POST',
        body: form,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new OperationError(await responseError(response, 'The file could not be imported.'));
      }
      const imported = parseDraft(await response.json());
      setDraft(imported);
      setName(imported.name);
      requestAnimationFrame(() => window.document.getElementById('resume-name')?.focus());
    });
  }

  function exportResume(extension: 'md' | 'pdf') {
    perform('Saving latest edits before download…', async () => {
      const saved = await flushCurrent();
      if (!saved) {
        return;
      }
      const route = extension === 'pdf' ? 'pdf' : 'markdown';
      const response = await fetch(
        `/resumes/${saved.id}/${route}?version=${saved.version}${extension === 'pdf' ? '&download=1' : ''}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        throw new OperationError(
          await responseError(response, 'The download could not be generated.')
        );
      }
      const expected = extension === 'pdf' ? 'application/pdf' : 'text/markdown';
      if (!response.headers.get('content-type')?.includes(expected)) {
        throw new OperationError(
          'The server did not return a valid resume download. Please retry.'
        );
      }
      const blob = await response.blob();
      if (!blob.size && extension === 'pdf') {
        throw new OperationError('The PDF was empty. Please retry.');
      }
      downloadBlob(blob, fileName(saved.name, extension));
      setNotice(`${extension === 'pdf' ? 'PDF' : 'Markdown'} download started.`);
    });
  }

  function retrySave() {
    perform('Retrying save…', async () => {
      if (queue && !(await queue.retry())) {
        throw new OperationError(
          queue.getSnapshot().error ?? 'Saving failed. Your edits are still here.'
        );
      }
    });
  }

  function backup() {
    if (!queue) {
      return;
    }
    try {
      const document = queue.getSnapshot().document;
      downloadBlob(
        new Blob([document.contentMarkdown], { type: 'text/markdown;charset=utf-8' }),
        fileName(`${document.name} - unsaved`, 'md')
      );
      setNotice('Unsaved Markdown backup downloaded. This does not save the resume to PostgreSQL.');
    } catch {
      setOperationError(
        'The backup download could not start. Your edits are still here. Please retry.'
      );
    }
  }

  const menuProps = {
    library,
    busy: !!busy,
    titleRef,
    onSwitch: switchDocument,
    onNew: () => openDialog('new'),
    onImport: () => openDialog('import'),
  };
  const dialogTitle =
    dialog === 'new'
      ? 'New resume'
      : dialog === 'rename'
        ? 'Rename resume'
        : dialog === 'delete'
          ? 'Delete resume?'
          : draft
            ? 'Review imported resume'
            : 'Import resume';

  return (
    <div className={styles.editor}>
      <div className={styles.frame}>
        <SiteHeader activePage="resumes" />
        <main className={styles.main}>
          {availabilityError && (
            <div className={styles.errorBox} role="alert">
              <strong>Resume storage unavailable</strong>
              <p>{availabilityError}</p>
              <p>Check the PostgreSQL configuration and connection, then retry.</p>
              <button type="button" className={styles.button} onClick={refresh} disabled={!!busy}>
                Refresh and retry
              </button>
            </div>
          )}
          {operationError && (
            <div className={styles.errorBox} role="alert">
              <p>{operationError}</p>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setOperationError(null)}
              >
                Dismiss message
              </button>
            </div>
          )}
          <div className={styles.operationStatus} role="status" aria-live="polite">
            {busy ?? notice}
          </div>
          {queue ? (
            <DocumentWorkspace
              key={queue.getSnapshot().document.id}
              queue={queue}
              overflowRef={overflowRef}
              menuProps={menuProps}
              busy={!!busy}
              isLocked={isLocked}
              onAcknowledged={acknowledge}
              onExport={exportResume}
              onRename={() => openDialog('rename')}
              onDelete={() => openDialog('delete')}
              onRetry={retrySave}
              onBackup={backup}
            />
          ) : (
            <>
              <LibraryMenu {...menuProps} document={null} />
              {!availabilityError && (
                <section className={styles.empty} aria-label="Empty resume library">
                  <h2>Your resumes.</h2>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={menuProps.onNew}
                      disabled={!!busy}
                    >
                      New resume
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      onClick={menuProps.onImport}
                      disabled={!!busy}
                    >
                      Import .md / .pdf
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      <Modal
        opened={dialog !== null}
        onClose={closeDialog}
        title={dialogTitle}
        size="32rem"
        classNames={modalClasses}
        transitionProps={{ duration: 0 }}
        returnFocus={false}
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        closeButtonProps={{ disabled: !!busy, 'aria-label': 'Close dialog' }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busyRef.current) {
              return;
            }
            if (dialog === 'delete') {
              removeResume();
            } else if (dialog === 'rename') {
              renameResume();
            } else if (dialog === 'new') {
              createResume({
                name: name.trim(),
                themeKey: 'classic',
                contentMarkdown: '',
              });
            } else if (draft) {
              createResume({
                name: name.trim(),
                contentMarkdown: draft.contentMarkdown,
                themeKey: 'classic',
              });
            } else {
              importResume();
            }
          }}
        >
          {modalError && (
            <p className={styles.errorBox} role="alert">
              {modalError}
            </p>
          )}
          {busy && (
            <p className={styles.helper} role="status">
              {busy}
            </p>
          )}
          <fieldset className={styles.fieldset} disabled={!!busy}>
            {dialog === 'delete' ? (
              <p className={styles.dialogCopy}>
                Delete “{queue?.getSnapshot().document.name}”? This permanently removes the resume.
                This cannot be undone.
              </p>
            ) : dialog === 'import' && !draft ? (
              <>
                <p className={styles.dialogCopy}>
                  Import into a new resume. You will review and edit the draft before anything is
                  created; your current resume will not be overwritten.
                </p>
                <label className={styles.label} htmlFor="resume-import-file">
                  Markdown or PDF file
                </label>
                <input
                  className={styles.fileInput}
                  id="resume-import-file"
                  type="file"
                  accept=".md,.pdf,text/markdown,application/pdf"
                  required
                  data-autofocus
                  aria-describedby="resume-import-help"
                  onChange={(event) => {
                    if (!busyRef.current) {
                      setImportFile(event.currentTarget.files?.[0] ?? null);
                      setModalError(null);
                    }
                  }}
                />
                <p className={styles.helper} id="resume-import-help">
                  Up to 10 MiB. PDFs must contain selectable text and at most 20 pages. No OCR or
                  original layout recovery.
                </p>
              </>
            ) : (
              <>
                {draft && (
                  <div className={styles.importNotice}>
                    <p>
                      Review before creating. This creates a new resume, never replaces the current
                      one.
                    </p>
                    {draft.kind === 'pdf' && (
                      <p>
                        PDF text does not preserve the original layout. Reading order and spacing
                        may need correction. The uploaded PDF is not retained.
                      </p>
                    )}
                    {draft.warnings.length > 0 && (
                      <div role="status">
                        <strong>Import warnings</strong>
                        <ul>
                          {draft.warnings.map((warning, index) => (
                            <li key={`${index}-${warning}`}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <label className={styles.label} htmlFor="resume-name">
                  Resume name
                </label>
                <input
                  id="resume-name"
                  className={styles.input}
                  value={name}
                  required
                  maxLength={120}
                  data-autofocus
                  onChange={(event) => {
                    if (!busyRef.current) {
                      setName(event.currentTarget.value);
                    }
                  }}
                />
                {draft && (
                  <div className={styles.importDraft}>
                    <label className={styles.label} htmlFor="resume-import-draft">
                      Markdown draft
                    </label>
                    <textarea
                      id="resume-import-draft"
                      className={styles.textarea}
                      value={draft.contentMarkdown}
                      rows={14}
                      wrap="soft"
                      spellCheck={false}
                      onChange={(event) => {
                        if (!busyRef.current) {
                          setDraft({ ...draft, contentMarkdown: event.currentTarget.value });
                        }
                      }}
                    />
                  </div>
                )}
              </>
            )}
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.button}
                onClick={closeDialog}
                data-autofocus={dialog === 'delete' || undefined}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={dialog === 'delete' ? styles.dangerButton : styles.primaryButton}
                disabled={(dialog === 'new' || dialog === 'rename' || !!draft) && !name.trim()}
              >
                {dialog === 'delete'
                  ? 'Delete resume'
                  : dialog === 'rename'
                    ? 'Save name'
                    : dialog === 'import' && !draft
                      ? 'Review import'
                      : 'Create resume'}
              </button>
            </div>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}

function DocumentWorkspace({
  queue,
  overflowRef,
  menuProps,
  busy,
  isLocked,
  onAcknowledged,
  onExport,
  onRename,
  onDelete,
  onRetry,
  onBackup,
}: {
  queue: Autosave;
  overflowRef: RefObject<HTMLButtonElement | null>;
  menuProps: Omit<Parameters<typeof LibraryMenu>[0], 'document'>;
  busy: boolean;
  isLocked: () => boolean;
  onAcknowledged: (document: Resume) => void;
  onExport: (extension: 'md' | 'pdf') => void;
  onRename: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onBackup: () => void;
}) {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const { document } = snapshot;
  useEffect(() => {
    if (!snapshot.dirty) {
      onAcknowledged(snapshot.document);
    }
  }, [snapshot, onAcknowledged]);

  const statusText =
    snapshot.status === 'saved'
      ? 'Saved'
      : snapshot.status === 'saving'
        ? 'Saving…'
        : snapshot.status === 'pending'
          ? 'Unsaved changes'
          : 'Not saved · your edits are still here';

  return (
    <>
      <div className={styles.headingRow}>
        <div className={styles.titleGroup}>
          <LibraryMenu {...menuProps} document={document} />
          <div
            className={snapshot.status === 'error' ? styles.saveFailed : styles.saveStatus}
            role="status"
          >
            {snapshot.status === 'saved' && <Icon name="check" />}
            {statusText}
          </div>
        </div>
        <div className={styles.actions} aria-label="Resume actions">
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => onExport('md')}
          >
            Markdown
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy}
            onClick={() => onExport('pdf')}
          >
            Download PDF
          </button>
          <Menu position="bottom-end" classNames={menuClasses} transitionProps={{ duration: 0 }}>
            <Menu.Target>
              <button
                type="button"
                ref={overflowRef}
                className={styles.iconButton}
                aria-label="More resume actions"
                disabled={busy}
              >
                <Icon name="more" />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onRename} disabled={busy}>
                Rename resume
              </Menu.Item>
              <Menu.Item className={styles.menuDanger} onClick={onDelete} disabled={busy}>
                Delete resume
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      {snapshot.status === 'error' && (
        <div className={styles.errorBox} role="alert">
          <p>{snapshot.error}</p>
          <p>
            Your changes have not been saved. Keep this page open or download a backup before
            leaving.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={busy} onClick={onRetry}>
              Retry save
            </button>
            <button type="button" className={styles.button} disabled={busy} onClick={onBackup}>
              Download unsaved Markdown backup
            </button>
          </div>
        </div>
      )}
      <div className={styles.workspace}>
        <section className={styles.pane} aria-labelledby="resume-source-heading" aria-busy={busy}>
          <div className={styles.paneHeading}>
            <h2 id="resume-source-heading">
              <label htmlFor="resume-markdown">Markdown source</label>
            </h2>
          </div>
          <fieldset className={styles.fieldset} disabled={busy}>
            <textarea
              id="resume-markdown"
              className={`${styles.textarea} ${styles.sourceTextarea}`}
              value={document.contentMarkdown}
              rows={24}
              wrap="soft"
              spellCheck={false}
              onChange={(event) => {
                if (!isLocked()) {
                  queue.edit({
                    ...queue.getSnapshot().document,
                    contentMarkdown: event.currentTarget.value,
                  });
                }
              }}
            />
          </fieldset>
        </section>
        <div className={styles.pane}>
          <MarkdownPreview key={document.id} document={document} />
        </div>
      </div>
    </>
  );
}
