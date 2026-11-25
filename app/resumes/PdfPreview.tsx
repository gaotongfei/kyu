'use client';

import { useEffect, useState } from 'react';
import type { Resume } from './model';
import classes from './preview.module.css';

type Preview = { url: string; version: number; warnings: string[] };
export function PdfPreview({ document, pending }: { document: Resume; pending: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const { id, version } = document;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setLoading(true);
    setError(null);
    async function generate() {
      try {
        const response = await fetch(`/resumes/${id}/pdf?version=${version}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          throw new Error(
            typeof failure?.error === 'string'
              ? failure.error
              : 'PDF preview could not be generated. Check the connection and retry.'
          );
        }
        const blob = await response.blob();
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        const warnings = JSON.parse(
          decodeURIComponent(response.headers.get('X-Resume-Warnings') || '%5B%5D')
        ) as string[];
        setPreview({ url: objectUrl, version, warnings });
      } catch (failure) {
        if (active) {
          setError(
            failure instanceof Error ? failure.message : 'PDF preview could not be generated.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void generate();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [id, version, retry]);

  const stale = pending || preview?.version !== version;
  return (
    <section className={classes.pane} aria-label="PDF preview">
      <div className={classes.heading}>
        <h2>PDF preview</h2>
        <span>Classic · Letter</span>
      </div>
      <p className={classes.status} role="status">
        {pending
          ? 'Preview has pending edits — waiting for a successful save.'
          : loading
            ? 'Generating the saved PDF…'
            : preview && !error
              ? 'Same PDF renderer used for download.'
              : 'PDF preview unavailable.'}
      </p>
      {error && (
        <div className={classes.error} role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry preview
          </button>
        </div>
      )}
      {preview && !loading && !error ? (
        <>
          <iframe
            className={classes.pdf}
            title={`PDF preview of ${document.name}${stale ? ' (earlier saved version)' : ''}`}
            src={preview.url}
          />
          <p className={classes.fallback}>
            Viewer unavailable?{' '}
            <a href={preview.url} target="_blank" rel="noopener noreferrer">
              Open PDF
            </a>{' '}
            or{' '}
            <a href={preview.url} download={`${document.name}.pdf`}>
              download this preview
            </a>
            .{stale && ' This preview does not include pending edits.'}
          </p>
          {preview.warnings.length > 0 && (
            <div className={classes.warning}>
              <strong>Rendering notes</strong>
              <ul>
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p>Your Markdown source is unchanged.</p>
            </div>
          )}
        </>
      ) : (
        <div className={classes.placeholder}>
          {loading ? 'Preparing your PDF…' : 'Use Retry preview after checking your connection.'}
        </div>
      )}
    </section>
  );
}
