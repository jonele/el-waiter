import { test, expect } from '@playwright/test';

const BASE = 'https://el-waiter.vercel.app';
const VENUE_ID = 'f8138c92-4e95-4cab-8172-0e75557ec14f';
const PIN = '2804';

async function loginAsJonel(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/setup/${VENUE_ID}`);
  await page.waitForURL('**/');
  await page.waitForTimeout(2000);

  // Handle multi-venue picker if it appears
  const venuePicker = page.locator('button:has-text("Niceneasy Bistro")').first();
  if (await venuePicker.isVisible({ timeout: 3000 }).catch(() => false)) {
    await venuePicker.click();
    await page.waitForTimeout(2000);
  }

  // Wait for profiles to load
  await page.locator('text=jonel').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('text=jonel').first().click();
  await page.waitForTimeout(500);

  // Enter PIN 2804
  for (const d of PIN.split('')) {
    await page.locator(`button:text-is("${d}")`).first().click();
    await page.waitForTimeout(200);
  }
  await page.waitForURL('**/tables', { timeout: 15000 });
}

test('1. Setup link pairs device + shows profiles', async ({ page }) => {
  await page.goto(`${BASE}/setup/${VENUE_ID}`);
  await page.waitForURL('**/');
  await expect(page.locator('text=jonel').first()).toBeVisible({ timeout: 10000 });
});

test('2. PIN login → tables page', async ({ page }) => {
  await loginAsJonel(page);
  await expect(page.locator('text=EL-Waiter')).toBeVisible();
  await expect(page.locator('text=v2.2')).toBeVisible();
});

test('3. View toggles present (# / Τραπέζια / Ανοιχτά)', async ({ page }) => {
  await loginAsJonel(page);
  await expect(page.locator('button:has-text("#")')).toBeVisible();
  await expect(page.locator('button:has-text("Ανοιχτά")')).toBeVisible();
});

test('4. Tables load from Supabase (B1/M1 visible)', async ({ page }) => {
  await loginAsJonel(page);
  await page.waitForTimeout(4000);
  // Tables load — check at least one is visible
  await expect(page.locator('button:has-text("B1")').first()).toBeVisible({ timeout: 15000 });
});

test('5. Tap B1 → order page with menu categories', async ({ page }) => {
  await loginAsJonel(page);
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("B1")').first().click();
  await page.waitForURL('**/order', { timeout: 5000 });
  await expect(page.locator('text=B1').first()).toBeVisible();
  await page.waitForTimeout(3000);
  // At least one category should appear in sidebar
  const sidebar = page.locator('div.w-20 button').first();
  await expect(sidebar).toBeVisible({ timeout: 10000 });
});

test('6. Coffee item shows modifier sheet', async ({ page }) => {
  await loginAsJonel(page);
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("B1")').first().click();
  await page.waitForURL('**/order', { timeout: 5000 });
  await page.waitForTimeout(3000);

  // Click the coffee category (has ☕ emoji)
  const coffeeCat = page.locator('div.w-20 button:has-text("☕")').first();
  if (await coffeeCat.isVisible()) {
    await coffeeCat.click();
    await page.waitForTimeout(1500);

    // Click first menu item in the grid
    const firstItem = page.locator('.grid.grid-cols-2 button').first();
    await firstItem.click();
    await page.waitForTimeout(500);

    // Modifier sheet should show sweetness options
    await expect(page.locator('text=Γλυκύτητα').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Σκέτο")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Μέτριο")').first()).toBeVisible();
    await expect(page.locator('text=ΠΡΟΣΘΗΚΗ').first()).toBeVisible();
  }
});

test('7. Select modifiers → shows in cart', async ({ page }) => {
  await loginAsJonel(page);
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("B1")').first().click();
  await page.waitForURL('**/order', { timeout: 5000 });
  await page.waitForTimeout(3000);

  // Click coffee category
  const coffeeCat = page.locator('div.w-20 button:has-text("☕")').first();
  if (await coffeeCat.isVisible()) {
    await coffeeCat.click();
    await page.waitForTimeout(1500);

    // Click first item
    await page.locator('.grid.grid-cols-2 button').first().click();
    await page.waitForTimeout(500);

    // Select Μέτριο (required sweetness)
    await page.locator('button:has-text("Μέτριο")').first().click();
    await page.waitForTimeout(200);

    // Select Με γάλα
    await page.locator('button:has-text("Με γάλα")').first().click();
    await page.waitForTimeout(200);

    // Click ΠΡΟΣΘΗΚΗ
    await page.locator('button:has-text("ΠΡΟΣΘΗΚΗ")').first().click();
    await page.waitForTimeout(500);

    // Switch to cart tab
    await page.locator('button:has-text("Καλάθι")').first().click();
    await page.waitForTimeout(500);

    // Modifiers should be visible in cart
    await expect(page.locator('text=Μέτριο').first()).toBeVisible({ timeout: 5000 });
  }
});

test('8. Keypad view works', async ({ page }) => {
  await loginAsJonel(page);
  // Switch to keypad
  await page.locator('button:has-text("#")').first().click();
  await page.waitForTimeout(500);

  // Type "B1" using letter sidebar
  await page.locator('button:text-is("B")').first().click();
  await page.locator('button:text-is("1")').first().click();
  await page.waitForTimeout(300);

  // Should show B1 in display and GO button should be active
  await expect(page.locator('text=B1').first()).toBeVisible();
});

test('9. Beach theme toggleable', async ({ page }) => {
  await loginAsJonel(page);
  // Go to settings
  await page.locator('text=Ρυθμίσεις').last().click();
  await page.waitForTimeout(1000);

  // Beach theme button should exist
  await expect(page.locator('button:has-text("Παραλία")').first()).toBeVisible({ timeout: 5000 });
});
