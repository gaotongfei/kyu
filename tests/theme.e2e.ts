import { expect, test, type Page } from '@playwright/test';

const storageKey = 'mantine-color-scheme-value';
const canvas = { light: 'rgb(253, 253, 252)', dark: 'rgb(0, 0, 0)' };

async function storeScheme(page: Page, colorScheme: 'light' | 'dark') {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: storageKey,
    value: colorScheme,
  });
}

async function expectScheme(page: Page, colorScheme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', colorScheme);
  await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
  await expect(page.getByRole('main').locator('../..')).toHaveCSS(
    'background-color',
    canvas[colorScheme]
  );
}

for (const route of ['/jobs', '/resumes']) {
  for (const colorScheme of ['light', 'dark'] as const) {
    const storedScheme = colorScheme === 'light' ? 'dark' : 'light';

    test(`${route} follows system ${colorScheme} before hydration despite stored ${storedScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await storeScheme(page, storedScheme);
      await page.route('**/_next/**/*.js*', (request) => request.abort());
      await page.goto(route);
      await expectScheme(page, colorScheme);
    });

    test(`${route} follows system ${colorScheme} after hydration and live changes despite stored ${storedScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await storeScheme(page, storedScheme);
      await page.goto(route);
      await expectScheme(page, colorScheme);
      await page.emulateMedia({ colorScheme: storedScheme });
      await expectScheme(page, storedScheme);
      await page.emulateMedia({ colorScheme });
      await expectScheme(page, colorScheme);
      if (route === '/jobs') {
        await page.goto('/resumes');
      }
      await page.getByRole('button', { name: /— choose a resume$/ }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expectScheme(page, colorScheme);
      await expect(menu).toHaveCSS('color-scheme', colorScheme);

      await page.emulateMedia({ colorScheme: storedScheme });
      await expectScheme(page, storedScheme);
      await expect(menu).toHaveCSS('color-scheme', storedScheme);
      await page.emulateMedia({ colorScheme });
      await expectScheme(page, colorScheme);
      await expect(menu).toHaveCSS('color-scheme', colorScheme);
      await page.keyboard.press('Escape');

      await page.getByRole('link', { name: 'Discover', exact: true }).click();
      await expect(page).toHaveURL(/\/jobs(?:\?|$)/);
      await expectScheme(page, colorScheme);
      await page.emulateMedia({ colorScheme: storedScheme });
      await expectScheme(page, storedScheme);
      await page.emulateMedia({ colorScheme });
      await expectScheme(page, colorScheme);
      await page.reload();
      await expectScheme(page, colorScheme);
    });
  }
}
