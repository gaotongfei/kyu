import { lexer } from 'marked';
import type { Section } from './model';

// Marked normalizes line endings. Map token offsets back to the original source
// so section bodies retain their original whitespace and CRLFs.
export function importMarkdown(source: string, makeId = () => crypto.randomUUID()): Section[] {
  if (source.length > 500_000) {
    throw new Error('Markdown must contain at most 500,000 characters.');
  }
  const positions: number[] = [];
  let normalized = '';
  for (let i = 0; i < source.length; i += 1) {
    positions.push(i);
    if (source[i] === '\r') {
      normalized += '\n';
      if (source[i + 1] === '\n') {
        i += 1;
      }
    } else {
      normalized += source[i];
    }
  }
  positions.push(source.length);
  const sections: Section[] = [];
  let offset = 0;
  let bodyStart = 0;
  let titleMarkdown = '';
  let hasHeading = false;
  for (const token of lexer(normalized)) {
    if (token.type === 'heading' && token.depth === 2 && !/[\r\n]/.test(token.text)) {
      if (offset > bodyStart || hasHeading) {
        sections.push({
          id: makeId(),
          titleMarkdown,
          contentMarkdown: source.slice(positions[bodyStart], positions[offset]),
        });
      }
      titleMarkdown = token.text;
      hasHeading = true;
      bodyStart = offset + token.raw.length;
    }
    offset += token.raw.length;
  }
  sections.push({
    id: makeId(),
    titleMarkdown,
    contentMarkdown: source.slice(positions[bodyStart]),
  });
  if (sections.length > 100) {
    throw new Error('Imports can contain at most 100 sections.');
  }
  return sections;
}

export function exportMarkdown(sections: Section[]): string {
  let result = '';
  for (const section of sections) {
    const next = `${section.titleMarkdown ? `## ${section.titleMarkdown}\n` : ''}${section.contentMarkdown}`;
    if (result && next) {
      result += result.endsWith('\n\n') ? '' : result.endsWith('\n') ? '\n' : '\n\n';
    }
    result += next;
  }
  return result;
}

export function fileName(name: string, extension: 'md' | 'pdf') {
  return `${
    name
      .replace(/[^\p{L}\p{N}\- _]/gu, '')
      .trim()
      .slice(0, 80) || 'resume'
  }.${extension}`;
}
