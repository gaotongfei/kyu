import { expect, test, type Page } from '@playwright/test';

const unique = () => `Resume ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
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
}
async function saved(page: Page) {
  await expect(page.getByText('Saved to PostgreSQL', { exact: true })).toBeVisible();
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
      colorScheme === 'dark' ? 'rgb(25, 30, 26)' : 'rgb(253, 253, 252)'
    );
  });
}

test('system scheme changes update editor, portaled menus and dialogs without changing PDF paper', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/resumes');
  const name = unique();
  await create(page, name);
  const root = page.locator('html');
  const body = page.getByRole('textbox', { name: 'Content · Markdown', exact: true });
  const preview = page.getByTitle(`PDF preview of ${name}`, { exact: true });
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(body).toHaveCSS('background-color', 'rgb(32, 38, 33)');
  await expect(body).toHaveCSS('color', 'rgb(237, 241, 235)');
  await expect(body).toHaveCSS('color-scheme', 'dark');
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview).toHaveCSS('color-scheme', 'light');

  await switcher(page);
  const menu = page.getByRole('menu');
  await expect(menu).toHaveCSS('background-color', 'rgb(32, 38, 33)');
  await expect(menu).toHaveCSS('color-scheme', 'dark');
  await page.getByRole('menuitem', { name: 'New resume', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New resume', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Resume name', exact: true });
  await expect(dialog).toHaveCSS('background-color', 'rgb(32, 38, 33)');
  await expect(input).toHaveCSS('background-color', 'rgb(32, 38, 33)');
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
  await expect(menu).toHaveCSS('background-color', 'rgb(32, 38, 33)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(body).toHaveCSS('background-color', 'rgb(32, 38, 33)');
});

test('CRUD, ordered sections, flush-before-switch/export, reviewed imports and real PDF preview', async ({
  page,
}) => {
  const name = unique();
  await page.goto('/resumes');
  await create(page, name);
  const body = page.getByRole('textbox', { name: 'Content · Markdown', exact: true });
  await body.fill(
    '# José Morgan\n\nToronto · jose@example.com\n\n**Engineer** with [work](https://example.com).'
  );
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page
    .getByRole('textbox', { name: /Section title/ })
    .nth(1)
    .fill('Experience');
  await body.nth(1).fill('- Built thoughtful tools.\n- Used TypeScript and PostgreSQL.');
  await page.getByRole('button', { name: 'Move section 2: Experience up', exact: true }).click();
  await expect(body.first()).toHaveValue(/Built thoughtful/);
  // Switching while debounce is pending must flush rather than drop these edits.
  const other = unique();
  await create(page, other);
  await choose(page, name);
  await expect(body.first()).toHaveValue(/Built thoughtful/);
  await expect(body.nth(1)).toHaveValue(/José/);
  await page.reload();
  await expect(body.first()).toHaveValue(/Built thoughtful/);
  await page.getByRole('button', { name: 'More resume actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename resume', exact: true }).click();
  const renamed = `${name} renamed`;
  await page.getByRole('textbox', { name: 'Resume name', exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${renamed} — choose a resume`, exact: true })
  ).toBeVisible();
  await body.first().fill('- Latest export text.');
  const markdownDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const mdStream = await (await markdownDownload).createReadStream();
  const mdChunks: Buffer[] = [];
  for await (const chunk of mdStream!) {
    mdChunks.push(Buffer.from(chunk));
  }
  expect(Buffer.concat(mdChunks).toString()).toContain('Latest export text');
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const pdfStream = await (await pdfDownload).createReadStream();
  const pdfChunks: Buffer[] = [];
  for await (const chunk of pdfStream!) {
    pdfChunks.push(Buffer.from(chunk));
  }
  const pdf = Buffer.concat(pdfChunks);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByTitle(`PDF preview of ${renamed}`, { exact: true })).toHaveAttribute(
    'src',
    /^blob:/
  );
  await expect(page.getByRole('link', { name: 'Open PDF', exact: true })).toBeVisible();

  await switcher(page);
  await page.getByRole('menuitem', { name: 'Import .md / .pdf', exact: true }).click();
  await page.getByLabel('Markdown or PDF file').setInputFiles({
    name: 'source.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Intro\n\n## Work\nExact  spaces\n'),
  });
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Review imported resume', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Content · Markdown', exact: true }).last()
  ).toHaveValue('Exact  spaces\n');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${renamed} — choose a resume`, exact: true })
  ).toBeVisible();

  await switcher(page);
  await page.getByRole('menuitem', { name: 'Import .md / .pdf', exact: true }).click();
  await page
    .getByLabel('Markdown or PDF file')
    .setInputFiles({ name: 'recovered.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review imported resume', exact: true });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole('textbox', { name: 'Content · Markdown', exact: true })
  ).toHaveCount(1);
  await expect(review).toContainText('one editable block');
  const importedName = `${name} PDF import`;
  await review.getByRole('textbox', { name: 'Resume name', exact: true }).fill(importedName);
  await review.getByRole('button', { name: 'Create resume', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${importedName} — choose a resume`, exact: true })
  ).toBeVisible();
  await expect(body).toHaveCount(1);
  await expect(body).toHaveValue(/Latest export text/);
  await switcher(page);
  await page.getByRole('menuitem', { name: 'Import .md / .pdf', exact: true }).click();
  await page.getByLabel('Markdown or PDF file').setInputFiles({
    name: 'source.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Intro\n\n## Work\nExact  spaces\n'),
  });
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  const mdReview = page.getByRole('dialog', { name: 'Review imported resume', exact: true });
  await expect(mdReview).toBeVisible();
  const mdName = `${name} Markdown import`;
  await mdReview.getByRole('textbox', { name: 'Resume name', exact: true }).fill(mdName);
  await mdReview.getByRole('button', { name: 'Create resume', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${mdName} — choose a resume`, exact: true })
  ).toBeVisible();
  await expect(body).toHaveCount(2);
  await expect(body.nth(1)).toHaveValue('Exact  spaces\n');
  await choose(page, renamed);
  await expect(body).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove section', exact: true }).first().click();
  await page
    .getByRole('dialog', { name: 'Remove section?', exact: true })
    .getByRole('button', { name: 'Remove section', exact: true })
    .click();
  await expect(body).toHaveCount(1);
  await saved(page);

  await page.getByRole('button', { name: 'More resume actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete resume', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(body).toHaveCount(1);
  await page.getByRole('button', { name: 'More resume actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete resume', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete resume', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `${renamed} — choose a resume`, exact: true })
  ).toHaveCount(0);
});

test('two-tab conflict retains edits and refuses switching; local backup remains available', async ({
  page,
  context,
}) => {
  await page.goto('/resumes');
  const name = unique();
  await create(page, name);
  const other = await context.newPage();
  await other.goto('/resumes');
  const body = page.getByRole('textbox', { name: 'Content · Markdown', exact: true });
  await other
    .getByRole('textbox', { name: 'Content · Markdown', exact: true })
    .fill('Saved in the second tab.');
  await saved(other);
  await body.fill('Unsaved first-tab content must survive.');
  await expect(
    page.getByText('Not saved · your edits are still here', { exact: true })
  ).toBeVisible();
  await switcher(page);
  const choice = page
    .getByRole('menuitem')
    .filter({ hasNotText: /current resume|New resume|Import/ })
    .first();
  await choice.click();
  await expect(
    page.getByRole('button', { name: `${name} — choose a resume`, exact: true })
  ).toBeVisible();
  await expect(body).toHaveValue('Unsaved first-tab content must survive.');
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unsaved Markdown backup', exact: true }).click();
  expect((await backup).suggestedFilename()).toContain('unsaved');
  await other.close();
});

test('failed network saves preserve input, block export, warn on leaving, and recover on explicit retry', async ({
  page,
}) => {
  await page.goto('/resumes');
  await create(page, unique());
  await page.route('**/resumes*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  const body = page.getByRole('textbox', { name: 'Content · Markdown', exact: true });
  await body.fill('Offline edits must remain available.');
  await expect(
    page.getByText('Not saved · your edits are still here', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await expect(body).toHaveValue('Offline edits must remain available.');
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
  await page
    .getByRole('textbox', { name: 'Content · Markdown', exact: true })
    .fill('# Alex Morgan\n\nToronto, Canada · alex@example.com\n\nFictional verification sample.');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page
    .getByRole('textbox', { name: /Section title/ })
    .nth(1)
    .fill('Experience');
  await page
    .getByRole('textbox', { name: 'Content · Markdown', exact: true })
    .nth(1)
    .fill(
      '### Software Engineer\n**Example Studio**\n\n- Built thoughtful tools.\n- Worked with TypeScript and PostgreSQL.'
    );
  await saved(page);
  await page.getByTitle(`PDF preview of ${name}`, { exact: true }).waitFor();
  await expect(page.getByRole('link', { name: 'Open PDF', exact: true })).toHaveAttribute(
    'href',
    /^blob:/
  );
  const title = page.getByRole('button', { name: `${name} — choose a resume`, exact: true });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(title).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
    '16px'
  );
  const width = await page
    .locator('header')
    .evaluate((header) => header.parentElement!.getBoundingClientRect().width);
  expect(width).toBe(1280);
  const geometry = await page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect();
    const sections = document
      .getElementById('resume-sections-heading')!
      .parentElement!.getBoundingClientRect();
    const preview = document.querySelector('[aria-label="PDF preview"]')!.getBoundingClientRect();
    const wordmark = document.querySelector('header')!.firstElementChild!.getBoundingClientRect();
    return {
      headerLeft: header.left,
      headerRight: header.right,
      sectionsLeft: sections.left,
      previewRight: preview.right,
      sectionsWidth: sections.width,
      previewWidth: preview.width,
      wordmarkLeft: wordmark.left,
    };
  });
  expect(geometry.headerLeft).toBe(geometry.sectionsLeft);
  expect(geometry.headerRight).toBe(geometry.previewRight);
  expect(geometry.wordmarkLeft).toBe(geometry.sectionsLeft);
  expect(geometry.sectionsWidth).toBeCloseTo(geometry.previewWidth, 4);
  for (const viewportWidth of [1920, 1100]) {
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    const frameWidth = await page
      .locator('header')
      .evaluate((header) => header.parentElement!.getBoundingClientRect().width);
    expect(frameWidth).toBe(Math.min(viewportWidth, 1280));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewportWidth);
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
  await touchPage.goto('/resumes');
  const add = await touchPage
    .getByRole('button', { name: 'Add section', exact: true })
    .boundingBox();
  expect(add?.height).toBeGreaterThanOrEqual(44);
  await touch.close();
});
