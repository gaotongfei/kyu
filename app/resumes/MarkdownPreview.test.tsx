import { render, screen } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';
import { MarkdownPreview } from './MarkdownPreview';
import type { Resume } from './model';
import { parseResumeMarkdown } from './resume-markdown';

jest.mock('./classic-font', () => ({ classicFont: { className: 'classic-font' } }));
jest.mock('./MarkdownContent', () => {
  const actual = jest.requireActual('./MarkdownContent');
  return { ...actual, MarkdownContent: jest.fn(actual.MarkdownContent) };
});

const document: Resume = {
  id: 'doc',
  name: 'Base',
  version: 1,
  contentMarkdown: '**Local edits** before save.',
  themeKey: 'classic',
  createdAt: '',
  updatedAt: '',
};

it('renders local Markdown immediately without network requests or explanatory copy', () => {
  const originalFetch = global.fetch;
  const fetch = jest.fn();
  global.fetch = fetch;
  try {
    const { rerender } = render(<MarkdownPreview document={document} />);
    expect(screen.getByRole('article', { name: 'Resume preview of Base' })).toHaveTextContent(
      'Local edits before save.'
    );
    expect(screen.getByText('Local edits').tagName).toBe('STRONG');
    rerender(
      <MarkdownPreview
        document={{
          ...document,
          contentMarkdown: '*Newer* text.',
        }}
      />
    );
    expect(screen.getByText('Newer').tagName).toBe('EM');
    expect(screen.queryByText('Local edits')).not.toBeInTheDocument();
    rerender(<MarkdownPreview document={document} />);
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/PDF is generated|Shared Classic styling/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/PDF preview/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
  }
});

it('shows unsupported source literally without injecting HTML, images, or unsafe links', () => {
  const contentMarkdown =
    '<img src="https://example.test/private.png" onerror="alert(1)">\n\n![photo](https://example.test/image.png)\n\n[bad](javascript:alert%281%29) and [control](https://example.com/&#x0a;path) and [safe](https://example.com).';
  const { container } = render(<MarkdownPreview document={{ ...document, contentMarkdown }} />);
  expect(container.querySelector('img, script, iframe')).toBeNull();
  expect(screen.getByRole('article')).toHaveTextContent('<img src=');
  expect(screen.getByRole('article')).toHaveTextContent('![photo]');
  expect(screen.getByRole('article')).toHaveTextContent('[bad](javascript:');
  expect(screen.getByRole('article')).toHaveTextContent(
    '[control](https://example.com/&#x0a;path)'
  );
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute(
    'href',
    'https://example.com/'
  );
  expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute('rel', 'noopener noreferrer');
  const notes = screen.getByRole('complementary', { name: 'Markdown rendering notes' });
  expect(notes).toHaveTextContent('Raw HTML');
  expect(notes).toHaveTextContent('Images');
});

it('leaves empty content blank and shares Classic document styles independently of UI colors', () => {
  const { container } = render(<MarkdownPreview document={{ ...document, contentMarkdown: '' }} />);
  expect(screen.getByRole('article')).toBeEmptyDOMElement();
  expect(screen.getByRole('article')).toHaveStyle({
    color: '#272c28',
    backgroundColor: '#ffffff',
    fontSize: '10.5pt',
    lineHeight: '1.45',
  });
  expect(container.querySelector('iframe')).toBeNull();
});

it('contains within-limit parser failures and recovers when the source changes', () => {
  const deeplyNested = {
    ...document,
    contentMarkdown: `${'> '.repeat(5000)}hello`,
  };
  let rerender!: ReturnType<typeof render>['rerender'];
  expect(() => {
    ({ rerender } = render(<MarkdownPreview document={deeplyNested} />));
  }).not.toThrow();
  expect(screen.getByRole('alert')).toHaveTextContent('Markdown preview unavailable');
  expect(deeplyNested.contentMarkdown).toHaveLength(10005);
  rerender(<MarkdownPreview document={document} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('article')).toHaveTextContent('Local edits before save.');
});

it('refuses excessive DOM nesting even when Markdown parsing succeeds', () => {
  const contentMarkdown = `${'> '.repeat(30)}parsed safely`;
  expect(parseResumeMarkdown(contentMarkdown).blocks[0].type).toBe('quote');
  const { rerender } = render(<MarkdownPreview document={{ ...document, contentMarkdown }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Markdown preview unavailable');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(contentMarkdown).toContain('parsed safely');
  rerender(<MarkdownPreview document={document} />);
  expect(screen.getByRole('article')).toHaveTextContent('Local edits before save.');
});

it('renders shared headings, ordered lists, quotes, code and hard breaks as semantic HTML', () => {
  const contentMarkdown =
    '### Role\n\n4. Fourth\n5. Fifth\n\n> A quote\n\n---\n\n`inline`\n\n```txt\n<literal>&code;\n```\n\nFirst  \nSecond';
  const { container } = render(<MarkdownPreview document={{ ...document, contentMarkdown }} />);
  expect(screen.getByRole('heading', { name: 'Role', level: 3 })).toHaveStyle({ fontSize: '12pt' });
  expect(screen.getByRole('article').firstElementChild?.tagName).toBe('H3');
  expect(screen.getAllByRole('heading')).toHaveLength(2);
  expect(container.querySelector('ol')).toHaveAttribute('start', '4');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  expect(container.querySelector('blockquote')).toHaveTextContent('A quote');
  expect(screen.getByRole('separator')).toBeInTheDocument();
  expect(container.querySelector('pre code')).toHaveTextContent('<literal>&code;');
  expect(container.querySelector('br')).not.toBeNull();
});

it('shares forward references, prototype-safe definitions, and literal task-list numbering', () => {
  const contentMarkdown = [
    '# [Profile][constructor]',
    '',
    '[__proto__] [undefined] [escaped](https://example.com/a\\(b\\)?a=1&amp;b=2)',
    '',
    '1. First',
    '2. [x] **task source** [not a link](https://example.invalid/task)',
    '3. Third',
    '',
    '[constructor]: https://example.com/first',
    '[constructor]: https://example.com/second',
    '[__proto__]: https://example.com/proto',
  ].join('\n');
  const { container } = render(<MarkdownPreview document={{ ...document, contentMarkdown }} />);
  expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
    'href',
    'https://example.com/first'
  );
  expect(screen.getByRole('link', { name: 'proto' })).toHaveAttribute(
    'href',
    'https://example.com/proto'
  );
  expect(screen.getByRole('link', { name: 'escaped' })).toHaveAttribute(
    'href',
    'https://example.com/a(b)?a=1&b=2'
  );
  expect(screen.getByRole('article')).toHaveTextContent('[undefined]');
  expect(screen.queryByRole('link', { name: 'not a link' })).not.toBeInTheDocument();
  expect(screen.getByRole('article')).toHaveTextContent('2. [x] **task source**');
  expect([...container.querySelectorAll('ol')].map((list) => list.getAttribute('start'))).toEqual([
    '1',
    '3',
  ]);
  expect(container.querySelectorAll('li')).toHaveLength(3); // Two items plus the rendering note.
  expect(container.querySelector('input')).toBeNull();
});

it('contains adapter failures and retries only when Markdown content changes', () => {
  const actual = jest.requireActual<typeof import('./MarkdownContent')>('./MarkdownContent');
  const renderer = jest.mocked(MarkdownContent);
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  renderer.mockImplementation(() => {
    throw new Error('Synthetic adapter failure');
  });
  try {
    const { rerender } = render(<MarkdownPreview document={document} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Markdown preview unavailable');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    renderer.mockImplementation(actual.MarkdownContent);
    rerender(<MarkdownPreview document={{ ...document, name: 'Renamed' }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <MarkdownPreview document={{ ...document, contentMarkdown: '**Recovered** Markdown.' }} />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Recovered Markdown.');
  } finally {
    renderer.mockImplementation(actual.MarkdownContent);
    error.mockRestore();
  }
});
