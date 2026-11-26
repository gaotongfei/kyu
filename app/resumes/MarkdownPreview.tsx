'use client';

import { Component, useMemo, type ReactNode } from 'react';
import { classicFont } from './classic-font';
import { classicDocumentStyle, MarkdownContent } from './MarkdownContent';
import type { Resume } from './model';
import { isPreviewDepthSafe } from './preview-depth';
import { parseResumeMarkdown } from './resume-markdown';
import classes from './preview.module.css';

function PreviewError() {
  return (
    <div className={classes.error} role="alert">
      <strong>Markdown preview unavailable.</strong>
      <p>Edit the Markdown or download a copy.</p>
    </div>
  );
}

type BoundaryProps = { contentMarkdown: string; children: ReactNode };
type BoundaryState = { contentMarkdown: string; failed: boolean };
class PreviewBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { contentMarkdown: this.props.contentMarkdown, failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    return props.contentMarkdown === state.contentMarkdown
      ? null
      : { contentMarkdown: props.contentMarkdown, failed: false };
  }

  render() {
    return this.state.failed ? <PreviewError /> : this.props.children;
  }
}

function PreviewContent({ document }: { document: Resume }) {
  const parsed = useMemo(() => {
    try {
      const parsed = parseResumeMarkdown(document.contentMarkdown);
      return isPreviewDepthSafe(parsed.blocks) ? parsed : null;
    } catch {
      return null;
    }
  }, [document.contentMarkdown]);
  if (!parsed) {
    return <PreviewError />;
  }
  return (
    <>
      <article
        className={`${classes.paper} ${classicFont.className}`}
        aria-label={`Resume preview of ${document.name}`}
        style={classicDocumentStyle}
      >
        <MarkdownContent parsed={parsed} />
      </article>
      {parsed.warnings.length > 0 && (
        <aside className={classes.warning} aria-label="Markdown rendering notes">
          <strong>Rendering notes</strong>
          <ul>
            {parsed.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </aside>
      )}
    </>
  );
}

export function MarkdownPreview({ document }: { document: Resume }) {
  return (
    <section className={classes.pane} aria-label="Markdown preview">
      <div className={classes.heading}>
        <h2>Preview</h2>
        <span>Classic</span>
      </div>
      <PreviewBoundary contentMarkdown={document.contentMarkdown}>
        <PreviewContent document={document} />
      </PreviewBoundary>
    </section>
  );
}
