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

    await page.getByRole('link', { name: 'Programme' }).click()
    await expect(page).toHaveURL(/\/programs/)
    await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible()

    await page.getByRole('link', { name: 'Sage-Mapping' }).click()
    await expect(page).toHaveURL(/\/mappings/)
    await expect(page.getByRole('heading', { name: /sage/i })).toBeVisible()
  })

  test('root path redirects to /projects', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/projects/)
  })

  test('active nav item is highlighted', async ({ page }) => {
    await page.goto('/persons')
    const personsLink = page.getByRole('link', { name: 'Personen' })
    await expect(personsLink).toHaveClass(/bg-blue-600/)
  })
})
