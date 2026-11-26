import { expect, test, type Page } from '@playwright/test';

async function layout(page: Page) {
  await expect(page.locator('header')).toHaveCount(1);
  return page.locator('header').evaluate((header) => {
    const bounds = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      frame: bounds(header.parentElement!),
      header: bounds(header),
      wordmark: bounds(header.firstElementChild!),
      links: Array.from(header.querySelectorAll('nav a'), bounds),
      main: bounds(document.querySelector('main')!),
      pageWidth: document.documentElement.scrollWidth,
    };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`Jobs and Resumes share navbar and content geometry in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    for (const width of [1920, 1440, 1280, 1100, 650, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/jobs');
      const jobs = await layout(page);
      const gutter = width <= 650 ? 22 : 30;
      const frameWidth = Math.min(width, 1280);
      expect(jobs.frame.width).toBe(frameWidth);
      expect(jobs.frame.x).toBe((width - frameWidth) / 2);
      expect(jobs.header.x).toBe(jobs.frame.x + gutter);
      expect(jobs.header.width).toBe(frameWidth - gutter * 2);
      expect(jobs.main.x).toBe(jobs.header.x);
      expect(jobs.main.width).toBe(jobs.header.width);
      expect(jobs.pageWidth).toBe(width);
      await expect(page.getByText('Your next move.', { exact: true })).toHaveCount(0);
      const navigation = page.getByRole('navigation', { name: 'Main navigation' });
      await expect(navigation.locator('[aria-current="page"]')).toHaveText('Discover');
      if (width === 1440 || width === 320) {
        await page.screenshot({
          path: `.thinkrail/context/verification/navbar-jobs-${colorScheme}-${width}.png`,
          fullPage: true,
        });
      }

      await navigation.getByRole('link', { name: 'Resumes' }).click();
      await expect(page).toHaveURL(/\/resumes(?:\?|$)/);
      await expect(navigation.locator('[aria-current="page"]')).toHaveText('Resumes');
      const resumes = await layout(page);
      expect(resumes.frame).toMatchObject({ x: jobs.frame.x, width: jobs.frame.width });
      expect(resumes.header).toEqual(jobs.header);
      expect(resumes.wordmark).toEqual(jobs.wordmark);
      expect(resumes.links).toEqual(jobs.links);
      expect(resumes.main.x).toBe(jobs.main.x);
      expect(resumes.main.width).toBe(jobs.main.width);
      expect(resumes.pageWidth).toBe(width);
      if (width === 1440 || width === 320) {
        await page.screenshot({
          path: `.thinkrail/context/verification/navbar-resumes-${colorScheme}-${width}.png`,
          fullPage: true,
        });
      }
    }
  });
}

test('shared navigation supports keyboard, touch targets and 200% text at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  for (const route of ['/jobs', '/resumes']) {
    await page.goto(route);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    for (const link of await navigation.getByRole('link').all()) {
      const bounds = await link.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
  }
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Discover' }).focus();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: 'Resumes' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(navigation.getByRole('link', { name: 'Discover' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(navigation.locator('[aria-current="page"]')).toHaveText('Discover');
});
