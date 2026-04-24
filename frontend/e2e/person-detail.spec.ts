import { test, expect } from '@playwright/test'

const API = 'http://localhost:8000'

test.describe('Person-Detail', () => {
  let personId: number

  test.beforeEach(async ({ request }) => {
    const uid = `${Date.now()}_${Math.floor(Math.random() * 100000)}`
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

  test('Urlaubskontingent löschen zeigt Bestätigungsdialog', async ({ page, request }) => {
    // Create a contingent for a year not auto-created (2030)
    await request.post(`${API}/persons/${personId}/vacation-contingents`, {
      data: { year: 2030, total_days: 25 },
    })

    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Urlaubskontingente' }).click()

    // Click the trash button for year 2030
    const row2030 = page.getByRole('row').filter({ hasText: '2030' })
    await row2030.getByRole('button', { name: /löschen/i }).click()

    // Confirmation modal should appear
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('2030')
    await expect(dialog.getByRole('button', { name: /löschen/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /abbrechen/i })).toBeVisible()

    // Confirm deletion
    await dialog.getByRole('button', { name: /löschen/i }).click()
    await page.waitForLoadState('networkidle')

    // Row should be gone
    await expect(page.getByRole('row').filter({ hasText: '2030' })).not.toBeVisible()
  })

  test('Abwesenheit bearbeiten öffnet vorausgefülltes Modal', async ({ page, request }) => {
    await request.post(`${API}/persons/${personId}/absences`, {
      data: {
        absence_type: 'vacation',
        status: 'planned',
        start_date: '2030-07-01',
        end_date: '2030-07-14',
        note: 'Sommerurlaub',
      },
    })

    await page.goto(`/persons/${personId}`)
    await page.waitForLoadState('networkidle')

    const row = page.getByRole('row').filter({ hasText: '2030-07-01' })
    await row.getByRole('button', { name: /bearbeiten/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: /bearbeiten/i })).toBeVisible()
    // Start date should be pre-filled
    await expect(dialog.getByLabel(/von/i)).toHaveValue('2030-07-01')
  })

  test('Klick auf Personenzeile in Liste navigiert zur Detailseite', async ({ page }) => {
    await page.goto('/persons')
    await page.waitForLoadState('networkidle')
    // Navigate via row click — find the row for our created person
    await page.getByRole('row').filter({ hasText: 'Detail-Test' }).first().click()
    await expect(page).toHaveURL(/\/persons\/\d+/)
  })
})
