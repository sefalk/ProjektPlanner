import { test, expect } from '@playwright/test'

/**
 * Ensures navigating through all main pages produces no browser console errors
 * (uncaught JS exceptions, failed network requests that log errors, React errors, etc.).
 *
 * This catches regressions like the `toFixed` crash on CalendarPage that TypeScript
 * alone could not detect because it only validates types at compile time.
 */

const PAGES = [
  '/calendar',
  '/projects',
  '/persons',
  '/programs',
  '/mappings',
  '/import',
  '/settings',
]

// Messages we know are harmless and can safely ignore.
const IGNORED_PATTERNS = [
  /favicon/i,
  /Download the React DevTools/i,
  /ReactDOM.render is no longer supported/i,
]

function isIgnored(message: string): boolean {
  return IGNORED_PATTERNS.some((re) => re.test(message))
}

test('keine Konsolenfehler beim Navigieren aller Seiten', async ({ page }) => {
  const errors: string[] = []

  page.on('pageerror', (err) => {
    if (!isIgnored(err.message)) {
      errors.push(`[pageerror] ${err.message}`)
    }
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isIgnored(msg.text())) {
      errors.push(`[console.error] ${msg.text()}`)
    }
  })

  for (const path of PAGES) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }

  expect(
    errors,
    `Konsolenfehler beim Navigieren:\n${errors.join('\n')}`,
  ).toHaveLength(0)
})

test('keine Konsolenfehler nach Seiten-Reload', async ({ page }) => {
  const errors: string[] = []

  page.on('pageerror', (err) => {
    if (!isIgnored(err.message)) {
      errors.push(`[pageerror] ${err.message}`)
    }
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isIgnored(msg.text())) {
      errors.push(`[console.error] ${msg.text()}`)
    }
  })

  await page.goto('/calendar')
  await page.waitForLoadState('networkidle')
  await page.reload()
  await page.waitForLoadState('networkidle')

  expect(
    errors,
    `Konsolenfehler nach Reload:\n${errors.join('\n')}`,
  ).toHaveLength(0)
})
