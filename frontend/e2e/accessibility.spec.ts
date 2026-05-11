import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PAGES = [
  { name: 'Projekte', path: '/projects' },
  { name: 'Personen', path: '/persons' },
  { name: 'Kalender', path: '/calendar' },
  { name: 'Sage-Import', path: '/import' },
  { name: 'Hauptprojekte', path: '/programs' },
  { name: 'Einstellungen', path: '/settings' },
  { name: 'Sage-Mapping', path: '/mappings' },
]

for (const { name, path } of PAGES) {
  test(`${name} — keine kritischen Accessibility-Verstöße`, async ({ page }) => {
    await page.goto(path)
    // Wait for page to fully load
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze()

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (critical.length > 0) {
      const messages = critical.map((v) =>
        `[${v.impact}] ${v.id}: ${v.description}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`
      ).join('\n\n')
      throw new Error(`${critical.length} kritische/serious Accessibility-Verstoesse auf "${path}":\n\n${messages}`)
    }

    expect(results.violations.filter((v) => v.impact === 'critical')).toHaveLength(0)
  })
}

test('Modal — korrekte ARIA-Attribute', async ({ page }) => {
  await page.goto('/projects')
  await page.getByRole('button', { name: /neu/i }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toHaveAttribute('aria-labelledby')

  // Labeled by the heading inside the dialog
  const labelledBy = await dialog.getAttribute('aria-labelledby')
  const heading = page.locator(`#${labelledBy}`)
  await expect(heading).toBeVisible()
})

test('Tabelle — Spaltenköpfe haben scope-Attribut', async ({ page }) => {
  await page.goto('/persons')
  await page.waitForLoadState('networkidle')

  const headers = page.getByRole('columnheader')
  const count = await headers.count()
  expect(count).toBeGreaterThan(0)
  for (const header of await headers.all()) {
    await expect(header).toHaveAttribute('scope', 'col')
  }
})

test('Tastaturnavigation — Modal mit Tab fokussierbar', async ({ page }) => {
  await page.goto('/projects')
  await page.getByRole('button', { name: /neu/i }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Tab through focusable elements inside dialog
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  const isInsideDialog = await focused.evaluate((el) => {
    const dialog = document.querySelector('[role="dialog"]')
    return dialog ? dialog.contains(el) : false
  })
  expect(isInsideDialog).toBe(true)
})
