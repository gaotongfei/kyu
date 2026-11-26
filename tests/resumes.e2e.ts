import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { extractText } from 'unpdf';
import { CLASSIC_THEME } from '../app/resumes/classic-theme';

const unique = () => `Resume ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
function contrast(foreground: string, background: string) {
  const luminance = (color: string) =>
    (color.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function expectNoSectionControls(scope: Page | Locator) {
  await expect(scope.getByRole('textbox', { name: /Section title/i })).toHaveCount(0);
  await expect(
    scope.getByRole('button', { name: /^(?:Add|Remove|Move|Collapse|Expand) section\b/i })
  ).toHaveCount(0);
  await expect(scope.getByRole('heading', { name: /^Sections\b/i })).toHaveCount(0);
  await expect(scope.getByText(/^\d+ sections?$/i)).toHaveCount(0);
}
async function expectWholeDocumentEditor(page: Page) {
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await expect(source).toHaveCount(1);
  await expect(source).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(page.locator('textarea')).toHaveCount(1);
  await expectNoSectionControls(page);
}
async function switcher(page: Page) {
  await page.getByRole('button', { name: /— choose a resume$/ }).click();
}
async function create(page: Page, name: string) {
  await switcher(page);
  await page.getByRole('menuitem', { name: 'New resume', exact: true }).click();
  await page.getByRole('textbox', { name: 'Resume name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create resume', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${name} — choose a resume`, exact: true })
  ).toBeVisible();
  await expectWholeDocumentEditor(page);
  await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveValue('');
}
async function saved(page: Page) {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}
async function choose(page: Page, name: string) {
  await switcher(page);
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${name} — choose a resume`, exact: true })
  ).toBeVisible();
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`system ${colorScheme} scheme is applied before hydration`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    // Leave the inline ColorSchemeScript running, but prevent React from hydrating.
    await page.route('**/_next/**/*.js*', (route) => route.abort());
    await page.goto('/resumes');
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', colorScheme);
    await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
    await expect(page.getByRole('main').locator('../..')).toHaveCSS(
      'background-color',
      colorScheme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(253, 253, 252)'
    );
  });
}

test('system scheme changes update editor, portaled menus and dialogs without changing Classic paper', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/resumes');
  const name = unique();
  await create(page, name);
  const root = page.locator('html');
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const preview = page.getByRole('article', { name: `Resume preview of ${name}`, exact: true });
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(body).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(body).toHaveCSS('color', 'rgb(241, 241, 241)');
  await expect(body).toHaveCSS('color-scheme', 'dark');
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview).toHaveCSS('color-scheme', 'light');

  await switcher(page);
  const menu = page.getByRole('menu');
  await expect(menu).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(menu).toHaveCSS('color-scheme', 'dark');
  await page.getByRole('menuitem', { name: 'New resume', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New resume', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Resume name', exact: true });
  await expect(dialog).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(input).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(input).toHaveCSS('color-scheme', 'dark');

  // An already-open portal must react to an OS preference change too.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'light');
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(input).toHaveCSS('color', 'rgb(39, 44, 40)');
  await expect(input).toHaveCSS('color-scheme', 'light');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await switcher(page);
  await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(menu).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(body).toHaveCSS('background-color', 'rgb(17, 17, 17)');
});

test('neutral-black chrome preserves readable contrast, light mode and white Classic paper', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/resumes');
  await create(page, 'Alex Morgan');
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await body.fill(
    '# Alex Morgan\n\nToronto, Canada · alex@example.com\n\n**Software engineer** building thoughtful, reliable product tools.\n\n## Experience\n\n### Software Engineer\n**Example Studio** · 2022–present\n\n- Built accessible tools with TypeScript and React.\n- Simplified data workflows with PostgreSQL.\n- Worked closely with design and product teams.'
  );
  await saved(page);
  await expect(page.getByText('Markdown is saved as written.', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Live Markdown preview. PDF is generated only on export.', { exact: true })
  ).toHaveCount(0);
  const root = page.getByRole('main').locator('../..');
  const download = page.getByRole('button', { name: 'Download PDF', exact: true });
  await expect(root).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(download).toHaveCSS('background-color', 'rgb(229, 229, 229)');
  await expect(download).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(page.getByRole('article')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await body.focus();
  const inputColors = await body.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      foreground: style.color,
      background: style.backgroundColor,
      placeholder: getComputedStyle(element, '::placeholder').color,
      border: style.borderTopColor,
      focus: style.outlineColor,
      outline: style.outlineStyle,
    };
  });
  expect(contrast(inputColors.foreground, inputColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(inputColors.placeholder, inputColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(inputColors.border, inputColors.background)).toBeGreaterThanOrEqual(3);
  expect(inputColors.outline).toBe('solid');
  expect(contrast(inputColors.focus, inputColors.background)).toBeGreaterThanOrEqual(3);
  const buttonColors = await download.evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }));
  expect(contrast(buttonColors.foreground, buttonColors.background)).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('heading', { name: 'Preview', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: '.thinkrail/context/verification/editor-markdown-black.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveCSS('background-color', 'rgb(253, 253, 252)');
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(download).toHaveCSS('background-color', 'rgb(48, 61, 52)');
  await expect(page.getByRole('article')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({
    path: '.thinkrail/context/verification/editor-markdown-light.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(download).toBeEnabled();
  await expect(download).toHaveCSS('background-color', 'rgb(229, 229, 229)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({
    path: '.thinkrail/context/verification/editor-markdown-black-narrow.png',
    fullPage: true,
  });
});

test('whole-document CRUD, live Markdown without PDF requests, exact imports and flush-before-export', async ({
  page,
}) => {
  const pdfRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/resumes\/[^/]+\/pdf(?:[?#]|$)/.test(request.url())) {
      pdfRequests.push(request.url());
    }
  });
  const name = unique();
  await page.goto('/resumes');
  await create(page, name);
  const selectedId = new URL(page.url()).searchParams.get('resume');
  expect(selectedId).toBeTruthy();
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const intro =
    '# José Morgan\n\nToronto · jose@example.com\n\n**Engineer** with [work](https://example.com).';
  await body.fill(intro);
  const preview = page.getByRole('article', { name: `Resume preview of ${name}`, exact: true });
  await expect(preview.getByRole('heading', { name: 'José Morgan', exact: true })).toBeVisible();
  await expect(preview).toHaveCSS('font-size', `${(CLASSIC_THEME.fontSize * 4) / 3}px`);
  const headingSize = await preview
    .getByRole('heading', { name: 'José Morgan' })
    .evaluate((heading) => parseFloat(getComputedStyle(heading).fontSize));
  expect(headingSize).toBeCloseTo((CLASSIC_THEME.headingSizes[0] * 4) / 3, 3);
  const experience =
    '## Experience\n\n- Built thoughtful tools.\n- Used TypeScript and PostgreSQL.';
  await body.fill(`${intro}\n\n${experience}`);
  // The entire document can be rearranged, with arbitrary headings and fenced heading-like text.
  const rearranged = [
    'Preamble before any heading.  ',
    '#### Projects first\n\n```markdown\n## Not a section\n# Keep this fence\n```',
    experience,
    intro,
    'Final paragraph with  exact   spaces.\n',
  ].join('\n\n');
  // Switching while debounce is pending must flush rather than drop any part of the source.
  const other = unique();
  await body.fill(rearranged);
  await create(page, other);
  expect(new URL(page.url()).searchParams.get('resume')).not.toBe(selectedId);
  await choose(page, name);
  expect(new URL(page.url()).searchParams.get('resume')).toBe(selectedId);
  await expect(body).toHaveValue(rearranged);
  await expect(preview.getByRole('heading')).toHaveText([
    'Projects first',
    'Experience',
    'José Morgan',
  ]);
  await expect(preview.locator('pre')).toContainText('## Not a section\n# Keep this fence');
  await expectWholeDocumentEditor(page);
  await page.reload();
  expect(new URL(page.url()).searchParams.get('resume')).toBe(selectedId);
  await expect(body).toHaveValue(rearranged);
  await expectWholeDocumentEditor(page);
  expect(pdfRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'More resume actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename resume', exact: true }).click();
  const renamed = `${name} renamed`;
  await page.getByRole('textbox', { name: 'Resume name', exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${renamed} — choose a resume`, exact: true })
  ).toBeVisible();
  await expect(body).toHaveValue(rearranged);
  expect(new URL(page.url()).searchParams.get('resume')).toBe(selectedId);
  const markdownSource = `${rearranged}\n\n- Latest export text.\n`;
  await body.fill(markdownSource);
  const markdownDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  expect(await downloadBytes(await markdownDownload)).toEqual(Buffer.from(markdownSource));
  expect(pdfRequests).toHaveLength(0);
  const pdfSource = `${rearranged}\n\n- Newest PDF text.\n`;
  await body.fill(pdfSource);
  await expect(page.getByRole('article')).toContainText('Newest PDF text');
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const pdf = await downloadBytes(await pdfDownload);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const extracted = await extractText(new Uint8Array(pdf), { mergePages: true });
  expect(extracted.text).toContain('Newest PDF text');
  expect(extracted.text).toContain('José Morgan');
  expect(pdfRequests).toHaveLength(1);
  expect(new URL(pdfRequests[0]).searchParams.has('download')).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(body).toHaveValue(pdfSource);

  const importedMarkdown = Buffer.from(
    '\uFEFF# Imported résumé\r\n\r\nLeading  spaces stay.\r\n\r\n## Work\r\nExact  spaces  \r\n\r\n```md\r\n## Still inside a fence\r\n```\r\n\r\n#### Arbitrary final heading\r\nLast line.\r\n',
    'utf8'
  );
  // Native textareas display LF even when the underlying untouched source contains CRLF.
  const displayedMarkdown = importedMarkdown.toString('utf8').replace(/\r\n/g, '\n');
  await switcher(page);
  await page.getByRole('menuitem', { name: 'Import .md / .pdf', exact: true }).click();
  await page.getByLabel('Markdown or PDF file').setInputFiles({
    name: 'source.md',
    mimeType: 'text/markdown',
    buffer: importedMarkdown,
  });
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  const canceledReview = page.getByRole('dialog', { name: 'Review imported resume', exact: true });
  await expect(canceledReview).toBeVisible();
  const canceledDraft = canceledReview.getByRole('textbox', {
    name: 'Markdown draft',
    exact: true,
  });
  await expect(canceledReview.locator('textarea')).toHaveCount(1);
  await expectNoSectionControls(canceledReview);
  await expect(canceledDraft).toHaveValue(displayedMarkdown);
  const canceledName = `${name} canceled import`;
  await canceledReview
    .getByRole('textbox', { name: 'Resume name', exact: true })
    .fill(canceledName);
  await canceledDraft.fill('# Edited draft that must never replace the open resume.');
  await canceledReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${renamed} — choose a resume`, exact: true })
  ).toBeVisible();
  await expect(body).toHaveValue(pdfSource);
  await switcher(page);
  await expect(page.getByRole('menuitem', { name: canceledName, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  expect(new URL(page.url()).searchParams.get('resume')).toBe(selectedId);
  await expect(body).toHaveValue(pdfSource);

  await switcher(page);
  await page.getByRole('menuitem', { name: 'Import .md / .pdf', exact: true }).click();
  await page
    .getByLabel('Markdown or PDF file')
    .setInputFiles({ name: 'recovered.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review imported resume', exact: true });
  await expect(review).toBeVisible();
  const pdfDraft = review.getByRole('textbox', { name: 'Markdown draft', exact: true });
  await expect(pdfDraft).toHaveCount(1);
  await expect(review.locator('textarea')).toHaveCount(1);
  await expectNoSectionControls(review);
  await expect(pdfDraft).toHaveValue(/Newest PDF text/);
  await expect(pdfDraft).toHaveValue(/José Morgan/);
  await expect(review).toContainText('PDF text does not preserve the original layout');
  const pdfDraftSource = await pdfDraft.inputValue();
  const importedName = `${name} PDF import`;
  await review.getByRole('textbox', { name: 'Resume name', exact: true }).fill(importedName);
  await review.getByRole('button', { name: 'Create resume', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${importedName} — choose a resume`, exact: true })
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get('resume')).not.toBe(selectedId);
  await expectWholeDocumentEditor(page);
  await expect(body).toHaveValue(pdfDraftSource);
  await choose(page, renamed);
  await expect(body).toHaveValue(pdfSource);
  await choose(page, importedName);
  await expect(body).toHaveValue(pdfDraftSource);

  await switcher(page);
  await page.getByRole('menuitem', { name: 'Import .md / .pdf', exact: true }).click();
  await page.getByLabel('Markdown or PDF file').setInputFiles({
    name: 'source.md',
    mimeType: 'text/markdown',
    buffer: importedMarkdown,
  });
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  const mdReview = page.getByRole('dialog', { name: 'Review imported resume', exact: true });
  await expect(mdReview).toBeVisible();
  await expect(mdReview.locator('textarea')).toHaveCount(1);
  await expectNoSectionControls(mdReview);
  await expect(mdReview.getByRole('textbox', { name: 'Markdown draft', exact: true })).toHaveValue(
    displayedMarkdown
  );
  const mdName = `${name} Markdown import`;
  // Change only the name: confirming an untouched review must preserve BOM, CRLF and whitespace.
  await mdReview.getByRole('textbox', { name: 'Resume name', exact: true }).fill(mdName);
  await mdReview.getByRole('button', { name: 'Create resume', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${mdName} — choose a resume`, exact: true })
  ).toBeVisible();
  const mdId = new URL(page.url()).searchParams.get('resume');
  expect(mdId).toBeTruthy();
  expect(mdId).not.toBe(selectedId);
  await expectWholeDocumentEditor(page);
  await expect(body).toHaveValue(displayedMarkdown);
  await choose(page, renamed);
  await expect(body).toHaveValue(pdfSource);
  await choose(page, mdName);
  await expect(body).toHaveValue(displayedMarkdown);
  await page.reload();
  expect(new URL(page.url()).searchParams.get('resume')).toBe(mdId);
  await expect(body).toHaveValue(displayedMarkdown);
  const exactDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  expect(await downloadBytes(await exactDownload)).toEqual(importedMarkdown);
  expect(pdfRequests).toHaveLength(1);
  await choose(page, renamed);
  await expect(body).toHaveValue(pdfSource);
  await saved(page);

  await page.getByRole('button', { name: 'More resume actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete resume', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectWholeDocumentEditor(page);
  await expect(body).toHaveValue(pdfSource);
  await page.getByRole('button', { name: 'More resume actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete resume', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete resume', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `${renamed} — choose a resume`, exact: true })
  ).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('resume')).not.toBe(selectedId);
  expect(pdfRequests).toHaveLength(1);
});

test('the full source bound survives worst-case JSON escaping, reload and exact export', async ({
  page,
}) => {
  await page.goto('/resumes');
  await create(page, unique());
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const source = '\u0001'.repeat(500_000);
  let actionBytes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) {
      actionBytes = Math.max(actionBytes, request.postDataBuffer()?.length ?? 0);
    }
  });
  await body.fill(source);
  await saved(page);
  expect(actionBytes).toBeGreaterThan(3_000_000);
  await page.reload();
  await expect(body).toHaveValue(source);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  expect((await downloadBytes(await download)).equals(Buffer.from(source))).toBe(true);
});

test('two-tab conflict retains edits and refuses switching; local backup remains available', async ({
  page,
  context,
}) => {
  await page.goto('/resumes');
  const switchTarget = unique();
  await create(page, switchTarget);
  const name = unique();
  await create(page, name);
  const other = await context.newPage();
  await other.goto(page.url());
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await other
    .getByRole('textbox', { name: 'Markdown source', exact: true })
    .fill('Saved in the second tab.');
  await saved(other);
  await body.fill('Unsaved first-tab content must survive.');
  await expect(
    page.getByText('Not saved · your edits are still here', { exact: true })
  ).toBeVisible();
  await switcher(page);
  await page.getByRole('menuitem', { name: switchTarget, exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${name} — choose a resume`, exact: true })
  ).toBeVisible();
  await expect(body).toHaveValue('Unsaved first-tab content must survive.');
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unsaved Markdown backup', exact: true }).click();
  const backupDownload = await backup;
  expect(backupDownload.suggestedFilename()).toContain('unsaved');
  expect(await downloadBytes(backupDownload)).toEqual(
    Buffer.from('Unsaved first-tab content must survive.')
  );
  await expect(other.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveValue(
    'Saved in the second tab.'
  );
  await other.close();
});

test('failed network saves preserve input, block export, warn on leaving, and recover on explicit retry', async ({
  page,
}) => {
  await page.goto('/resumes');
  await create(page, unique());
  const pdfRequests: string[] = [];
  const downloads: Download[] = [];
  page.on('request', (request) => {
    if (/\/resumes\/[^/]+\/pdf(?:[?#]|$)/.test(request.url())) {
      pdfRequests.push(request.url());
    }
  });
  page.on('download', (download) => downloads.push(download));
  await page.route('**/resumes*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await body.fill('Offline edits must remain available.');
  await expect(
    page.getByText('Not saved · your edits are still here', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('article')).toContainText('Offline edits must remain available.');
  const exportButton = page.getByRole('button', { name: 'Download PDF', exact: true });
  await exportButton.click();
  await expect(exportButton).toBeEnabled();
  await expect(body).toHaveValue('Offline edits must remain available.');
  expect(pdfRequests).toHaveLength(0);
  expect(downloads).toHaveLength(0);
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })
  ).toBe(true);
  await page.unroute('**/resumes*');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await saved(page);
  await expect(body).toHaveValue('Offline edits must remain available.');
  await page.reload();
  await expect(body).toHaveValue('Offline edits must remain available.');
});

test('live Markdown displays unsafe source literally and uses bundled local fonts without fetching resources', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('untrusted.invalid')) {
      externalRequests.push(request.url());
    }
  });
  await page.goto('/resumes');
  await create(page, unique());
  await page
    .getByRole('textbox', { name: 'Markdown source', exact: true })
    .fill(
      '# Safe preview\n\n**Bold** and *italic* with [safe](https://example.com).\n\n<script>document.documentElement.dataset.injected="true"</script>\n\n![photo](https://untrusted.invalid/image.png)\n\n[bad](javascript:alert%281%29)'
    );
  const preview = page.getByRole('article');
  await expect(preview.getByRole('heading', { name: 'Safe preview', exact: true })).toBeVisible();
  await expect(preview).toContainText('<script>');
  await expect(preview).toContainText('![photo]');
  await expect(preview).toContainText('[bad](javascript:');
  await expect(preview.locator('img, script, iframe')).toHaveCount(0);
  await expect(preview.getByRole('link')).toHaveCount(1);
  await expect(preview.getByRole('link', { name: 'safe' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-injected');
  await expect(page.getByRole('complementary', { name: 'Markdown rendering notes' })).toContainText(
    'Images: unsupported in Classic'
  );
  await page.evaluate(() => document.fonts.ready);
  const fontLoaded = await preview.evaluate((paper) => {
    const family = getComputedStyle(paper).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    return Array.from(document.fonts).some(
      (font) => font.family.replace(/["']/g, '') === family && font.status === 'loaded'
    );
  });
  expect(fontLoaded).toBe(true);
  expect(externalRequests).toHaveLength(0);
});

test('preview failures preserve the editor, autosave, saved source and unsaved backups', async ({
  page,
}) => {
  await page.goto('/resumes');
  await create(page, unique());
  const body = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const preview = page.getByRole('region', { name: 'Markdown preview', exact: true });
  for (const depth of [30, 100, 500, 1000, 1500, 1600, 1700]) {
    const source = `${'> '.repeat(depth)}still editable`;
    await body.fill(source);
    await expect(preview.getByRole('alert')).toContainText('Markdown preview unavailable');
    await expect(body).toHaveValue(source);
    await saved(page);
  }
  const nested = `${'> '.repeat(5000)}hello`;
  await body.fill(nested);
  await expect(preview.getByRole('alert')).toContainText('Markdown preview unavailable');
  await expect(body).toHaveValue(nested);
  await saved(page);
  await page.reload();
  await expect(body).toHaveValue(nested);
  await expect(preview.getByRole('alert')).toContainText('Markdown preview unavailable');
  await page.route('**/resumes*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  const unsaved = `${nested}\n\nUnsaved source retained.`;
  await body.fill(unsaved);
  await expect(
    page.getByText('Not saved · your edits are still here', { exact: true })
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unsaved Markdown backup', exact: true }).click();
  expect(await downloadBytes(await download)).toEqual(Buffer.from(unsaved));
  await expect(body).toHaveValue(unsaved);
  await page.unroute('**/resumes*');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await saved(page);
  await body.fill('# Recovered preview\n\nStill editable.');
  await expect(
    page.getByRole('article').getByRole('heading', { name: 'Recovered preview' })
  ).toBeVisible();
  await expect(preview.getByRole('alert')).toHaveCount(0);
  await saved(page);
});

test('desktop/320px frame, touch targets, keyboard navigation, reduced motion and zoom', async ({
  page,
  browser,
}) => {
  await page.goto('/resumes');
  const name = unique();
  await create(page, name);
  const initialId = new URL(page.url()).searchParams.get('resume');
  const initialPdf = await page.request.get(`/resumes/${initialId}/pdf?version=1`);
  expect(initialPdf.ok()).toBe(true);
  expect(initialPdf.headers()['cache-control']).toBe('private, no-store');
  const stalePdf = await page.request.get(`/resumes/${initialId}/pdf?version=0`);
  expect(stalePdf.status()).toBe(409);
  const staleMarkdown = await page.request.get(`/resumes/${initialId}/markdown?version=0`);
  expect(staleMarkdown.status()).toBe(409);
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.fill(
    '# Alex Morgan\n\nToronto, Canada · alex@example.com\n\nFictional verification sample.\n\n## Experience\n\n### Software Engineer\n**Example Studio**\n\n- Built thoughtful tools.\n- Worked with TypeScript and PostgreSQL.'
  );
  await saved(page);
  await expect(
    page.getByRole('article', { name: `Resume preview of ${name}`, exact: true })
  ).toContainText('Fictional verification sample.');
  const title = page.getByRole('button', { name: `${name} — choose a resume`, exact: true });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect
    .poll(() => page.getByRole('menu').evaluate((menu) => menu.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(title).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
    '16px'
  );
  const width = await page
    .locator('header')
    .evaluate((header) => header.parentElement!.getBoundingClientRect().width);
  expect(width).toBe(1280);
  const expectPaneGeometry = async () => {
    const header = await page.locator('header').boundingBox();
    const wordmark = await page.locator('header > :first-child').boundingBox();
    const sourceBounds = await source.boundingBox();
    const previewBounds = await page
      .getByRole('region', { name: 'Markdown preview', exact: true })
      .boundingBox();
    expect(header).not.toBeNull();
    expect(wordmark).not.toBeNull();
    expect(sourceBounds).not.toBeNull();
    expect(previewBounds).not.toBeNull();
    expect(header!.x).toBe(sourceBounds!.x);
    expect(header!.x + header!.width).toBe(previewBounds!.x + previewBounds!.width);
    expect(wordmark!.x).toBe(sourceBounds!.x);
    expect(sourceBounds!.width).toBeCloseTo(previewBounds!.width, 4);
    expect(sourceBounds!.y).toBeGreaterThanOrEqual(previewBounds!.y);
    expect(sourceBounds!.x + sourceBounds!.width).toBeLessThan(previewBounds!.x);
  };
  await expectPaneGeometry();
  for (const viewportWidth of [1920, 1280, 1100]) {
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    const frameWidth = await page
      .locator('header')
      .evaluate((header) => header.parentElement!.getBoundingClientRect().width);
    expect(frameWidth).toBe(Math.min(viewportWidth, 1280));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewportWidth);
    await expectPaneGeometry();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--kyu-duration').trim()
    )
  ).toMatch(/^0(?:ms|s)$/);
  await page.screenshot({ path: '.thinkrail/context/verification/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: '.thinkrail/context/verification/narrow.png', fullPage: true });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toContain(
    'user-scalable=no'
  );
  const touch = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 900 } });
  const touchPage = await touch.newPage();
  await touchPage.goto(`/resumes?resume=${initialId}`);
  for (const label of ['Download PDF', 'Markdown', `${name} — choose a resume`]) {
    const target = touchPage.getByRole('button', { name: label, exact: true });
    await expect(target).toBeVisible();
    const bounds = await target.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  await touch.close();
});
