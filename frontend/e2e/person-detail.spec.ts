import { test, expect } from '@playwright/test'

const API = 'http://localhost:8000'

test.describe('Person-Detail', () => {
  let personId: number

  test.beforeEach(async ({ request }) => {
    const uid = Date.now()
    const resp = await request.post(`${API}/persons`, {
      data: {
        name: `Detail-Test ${uid}`,
        sage_employee_name: `Test${uid}, Detail`,
        default_weekly_hours: 40,
      },
    })
    expect(resp.status()).toBe(201)
    const body = await resp.json() as { id: number }
    personId = body.id
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${API}/persons/${personId}`)
  })

  test('zeigt Personenname auf Detailseite', async ({ page }) => {
    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')
    const heading = page.getByRole('heading', { level: 2 })
    await expect(heading).toContainText('Detail-Test')
  })

  test('Tabs Abwesenheiten und Urlaubskontingente sind sichtbar', async ({ page }) => {
    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: 'Abwesenheiten' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Urlaubskontingente' })).toBeVisible()
  })

  test('Neue-Abwesenheit-Button öffnet Modal', async ({ page }) => {
    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /neue abwesenheit/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: /abwesenheit/i })).toBeVisible()
    await expect(dialog.getByLabel(/typ/i)).toBeVisible()
    await expect(dialog.getByLabel(/von/i)).toBeVisible()
  })

  test('Zurück-Button navigiert zur Personenliste', async ({ page }) => {
    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /personen/i }).click()
    await expect(page).toHaveURL(/\/persons$/)
    await expect(page.getByRole('heading', { name: 'Personen' })).toBeVisible()
  })

  test('Urlaubskontingente-Tab zeigt Neues-Kontingent-Button', async ({ page }) => {
    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Urlaubskontingente' }).click()
    await expect(page.getByRole('button', { name: /neues kontingent/i })).toBeVisible()
  })

  test('Klick auf Personenzeile in Liste navigiert zur Detailseite', async ({ page }) => {
    await page.goto('/persons')
    await page.waitForLoadState('networkidle')
    // Navigate via row click — find the row for our created person
    await page.getByRole('row').filter({ hasText: 'Detail-Test' }).first().click()
    await expect(page).toHaveURL(/\/persons\/\d+/)
  })
})
