import { test, expect, type Page } from '@playwright/test';

async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function openAssistant(page: Page) {
  await page.getByRole('button', { name: 'Meet your file assistant' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A home for everything.' })).toBeVisible();
});
test('responsive canvas, hidden selection bar, and accessible navigation', async ({ page }) => {
  await expect(page.getByRole('toolbar', { name: 'Selected file actions' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, 'All files');
  await expect(page.getByRole('heading', { name: 'All your files.' })).toBeVisible();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.locator('.files-grid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('real folder creation, copy, collision-safe paste, Trash, and restore', async ({ page }) => {
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('Autumn collection');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New folder', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select Brand guidelines.pdf', exact: true }).click();
  const tools = page.getByRole('toolbar', { name: 'Selected file actions' });
  await expect(tools).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Paste files', exact: true })).toHaveCount(0);
  await tools.getByRole('button', { name: 'Copy selected files', exact: true }).click();
  await expect(tools.getByRole('button', { name: 'Paste files', exact: true })).toBeVisible();
  const toastBounds = await page.locator('.toast').boundingBox();
  const toolbarBounds = await tools.boundingBox();
  expect(toastBounds!.y + toastBounds!.height).toBeLessThanOrEqual(toolbarBounds!.y);
  await navigate(page, 'All files');
  await page.getByRole('button', { name: 'Open Autumn collection', exact: true }).click();
  await page.getByRole('button', { name: 'Paste 1 items', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Brand guidelines.pdf', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Paste 1 items', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Brand guidelines (1).pdf', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select Brand guidelines (1).pdf', exact: true }).click();
  await tools.getByRole('button', { name: 'Move selected files to Trash', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Move files to Trash' })).toBeVisible();
  await page.getByRole('button', { name: 'Move item to Trash', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Move files to Trash' })).toHaveCount(0);
  await navigate(page, 'Trash');
  await page
    .getByRole('button', { name: 'Select Brand guidelines (1).pdf', exact: true })
    .first()
    .click();
  await tools.getByRole('button', { name: 'Restore selected files', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
});
test('global search and actual imported document preview', async ({ page }) => {
  await page.getByLabel('Import files', { exact: true }).setInputFiles({
    name: 'Field notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A quiet place for a good idea.'),
  });
  await expect(page.getByRole('status').filter({ hasText: 'New arrivals' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search files', exact: true }).fill('Field notes');
  await page.getByRole('button', { name: 'Open Field notes.txt', exact: true }).click();
  await expect(page.locator('.text-document')).toContainText('A quiet place for a good idea.');
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await page.reload();
  await page.getByRole('textbox', { name: 'Search files', exact: true }).fill('Field notes');
  await expect(
    page.getByRole('button', { name: 'Open Field notes.txt', exact: true }),
  ).toBeVisible();
});
test('continuous PDF pages and image zoom open in-app', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Brand guidelines.pdf', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible();
  await page.waitForFunction(
    () => (document.querySelector('.pdf-page canvas') as HTMLCanvasElement)?.width > 0,
  );
  await expect(page.locator('.page-count')).toContainText('2');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.pdf-controls')).toContainText('120%');
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Open Coastal escape.jpg', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Coastal escape.jpg', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.viewer-controls')).toContainText('125%');
});
test('local assistant parses dates and only organizes after confirmation', async ({ page }) => {
  await openAssistant(page);
  await page
    .getByRole('button', {
      name: 'Find a little faster A filename is only the beginning.',
      exact: true,
    })
    .click();
  await expect(page.getByRole('button', { name: /Alex Morgan — CV.pdf/ })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Ask your file assistant', exact: true })
    .fill('Organize my downloads');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Organize 6 files', exact: true })).toBeVisible();
  await expect(page.locator('.plan-item')).toHaveCount(6);
  await page.getByRole('button', { name: 'Organize 6 files', exact: true }).click();
  await expect(page.getByText('All taken care of.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Open Downloads', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Documents', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Videos', exact: true })).toBeVisible();
});
test('byte-verified cleanup is reversible and dark mode persists', async ({ page }) => {
  await openAssistant(page);
  await page
    .getByRole('button', {
      name: 'Make a little room Spot duplicates and old leftovers.',
      exact: true,
    })
    .click();
  await expect(page.getByText('Verified duplicate', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Files go to Trash. You can restore them anytime.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Move \d+ items to Trash$/ }).click();
  await expect(page.getByText('All taken care of.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('settings disclose provider scope and do not persist a browser API key', async ({ page }) => {
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  await page.getByRole('tab', { name: 'Intelligence', exact: true }).click();
  await expect(
    page.getByText('Kept in memory for this tab only. Never saved to browser storage.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Your API key', { exact: true }).fill('fictional-local-test-key');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  await page.getByRole('tab', { name: 'Intelligence', exact: true }).click();
  await expect(page.getByText('Key saved', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Your API key', { exact: true })).toBeEmpty();
});
test('long press reveals only icon actions and fits the small viewport', async ({ page }) => {
  const folder = page.getByRole('button', { name: 'Open Work projects', exact: true });
  await folder.scrollIntoViewIfNeeded();
  const box = await folder.boundingBox();
  if (!box) throw new Error('Folder not visible');
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await expect(page.getByRole('toolbar', { name: 'Selected file actions' })).toBeVisible();
  await page.mouse.up();
  const bounds = await page.getByRole('toolbar', { name: 'Selected file actions' }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const labels = await page
    .getByRole('toolbar', { name: 'Selected file actions' })
    .getByRole('button')
    .allTextContents();
  expect(labels.every((label) => !label.trim())).toBe(true);
});

test('video and audio previews load real playable media', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Downloads', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpine morning.mp4', exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= 1 && video.duration > 0;
  });
  await page.locator('video').evaluate(async (element) => {
    element.muted = true;
    await element.play();
  });
  await page.waitForFunction(() => (document.querySelector('video')?.currentTime || 0) > 0.05);
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Open Sunday mornings.wav', exact: true }).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return audio && audio.readyState >= 1 && audio.duration > 0;
  });
  await page.locator('audio').evaluate(async (element) => {
    element.muted = true;
    await element.play();
  });
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime || 0) > 0.05);
});

test('overview, dark mode, and assistant have no automated WCAG AA violations', async ({
  page,
}) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  };
  await scan();
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await scan();
  await openAssistant(page);
  await scan();
});

test('navigation taps stay responsive with twelve thousand indexed records', async ({ page }) => {
  test.setTimeout(90_000);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('findex-workspace-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    for (let index = 0; index < 12_000; index++)
      store.put({
        id: `performance-${index}`,
        name: `Notes ${index}.txt`,
        path: `/Work projects/Notes ${index}.txt`,
        parentId: 'projects',
        kind: 'file',
        category: 'documents',
        extension: 'txt',
        mime: 'text/plain',
        size: 100,
        createdAt: 1000,
        modifiedAt: 1000,
        favorite: false,
      });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A home for everything.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const measurements: number[] = [];
  for (let i = 0; i < 4; i++) {
    const elapsed = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const started = performance.now();
          (document.querySelector('[aria-label="Open navigation"]') as HTMLButtonElement).click();
          const poll = () =>
            document.querySelector('.sidebar.is-open')
              ? resolve(performance.now() - started)
              : requestAnimationFrame(poll);
          requestAnimationFrame(poll);
        }),
    );
    measurements.push(elapsed);
    await page.locator('.sidebar-close').click();
  }
  console.log(
    `12,000-record navigation latency: ${measurements.map((value) => value.toFixed(1)).join(', ')} ms`,
  );
  expect(Math.max(...measurements)).toBeLessThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
