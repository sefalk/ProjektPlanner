import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('sidebar is visible on all pages', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('ProjektPlanner')).toBeVisible()
    await expect(page.getByText('Project Planning')).toBeVisible()
  })

  test('navigates to all main pages via sidebar', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Projekte' }).click()
    await expect(page).toHaveURL(/\/projects/)
    await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible()

    await page.getByRole('link', { name: 'Personen' }).click()
    await expect(page).toHaveURL(/\/persons/)
    await expect(page.getByRole('heading', { name: 'Personen' })).toBeVisible()

    await page.getByRole('link', { name: 'Kalender' }).click()
    await expect(page).toHaveURL(/\/calendar/)
    await expect(page.getByRole('heading', { name: 'Kalender' })).toBeVisible()

    await page.getByRole('link', { name: 'Sage-Import' }).click()
    await expect(page).toHaveURL(/\/import/)
    await expect(page.getByRole('heading', { name: /sage-import/i })).toBeVisible()

    await page.getByRole('link', { name: 'Hauptprojekte' }).click()
    await expect(page).toHaveURL(/\/programs/)
    await expect(page.getByRole('heading', { name: 'Hauptprojekte' })).toBeVisible()

    await page.getByRole('link', { name: 'Sage-Mapping' }).click()
    await expect(page).toHaveURL(/\/mappings/)
    await expect(page.getByRole('heading', { name: /sage/i })).toBeVisible()

    await page.getByRole('link', { name: 'Einstellungen' }).click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()
  })

  test('root path redirects to /calendar', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/calendar/)
  })

  test('active nav item is highlighted', async ({ page }) => {
    await page.goto('/persons')
    const personsLink = page.getByRole('link', { name: 'Personen' })
    await expect(personsLink).toHaveClass(/bg-blue-600/)
  })
})
