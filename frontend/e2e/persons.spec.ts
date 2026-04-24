import { test, expect, type APIRequestContext } from '@playwright/test'

const API = 'http://localhost:8000'

async function deletePersonBySageName(request: APIRequestContext, sageName: string) {
  const resp = await request.get(`${API}/persons`)
  const all = await resp.json() as { id: number; sage_employee_name: string }[]
  const found = all.find((p) => p.sage_employee_name === sageName)
  if (found) await request.delete(`${API}/persons/${found.id}`)
}

test.describe('Personen-Verwaltung', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/persons')
    await page.waitForLoadState('networkidle')
  })

  test('zeigt die Personenliste an', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Personen' })).toBeVisible()
    await expect(page.getByRole('button', { name: /neu/i })).toBeVisible()
  })

  test('legt eine neue Person an', async ({ page, request }) => {
    const uid = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const sageName = `Person${uid}, Test`
    await page.getByRole('button', { name: /neu/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(/name \(anzeige\)/i).fill(`Test Person ${uid}`)
    await dialog.getByLabel(/sage-mitarbeiter/i).fill(sageName)
    await dialog.getByLabel(/wochenstunden/i).fill('40')

    await page.getByRole('button', { name: /speichern/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    await expect(page.getByText(`Test Person ${uid}`)).toBeVisible()

    await deletePersonBySageName(request, sageName)
  })

  test('Formular-Felder haben korrekte Beschriftungen (Accessibility)', async ({ page }) => {
    await page.getByRole('button', { name: /neu/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // All inputs should be labelled
    const inputs = dialog.getByRole('textbox')
    for (const input of await inputs.all()) {
      const label = await input.getAttribute('aria-label') ?? await input.evaluate(
        (el) => document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`)?.textContent
      )
      expect(label, `Input without accessible label found`).toBeTruthy()
    }
  })

  test('Formular enthält Arbeitswochenmuster-Dropdown', async ({ page }) => {
    await page.getByRole('button', { name: /neu/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel(/arbeitswochenmuster/i)).toBeVisible()
  })

  test('Formular enthält Verrechnungssatz-Feld', async ({ page }) => {
    await page.getByRole('button', { name: /neu/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel(/verrechnungssatz/i)).toBeVisible()
  })

  test('Bearbeiten-Button pro Zeile vorhanden wenn Personen existieren', async ({ page, request }) => {
    const uid = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const sageName = `EditPerson${uid}, Test`
    await page.getByRole('button', { name: /neu/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/name \(anzeige\)/i).fill(`Test EditPerson ${uid}`)
    await dialog.getByLabel(/sage-mitarbeiter/i).fill(sageName)
    await dialog.getByLabel(/wochenstunden/i).fill('40')
    await page.getByRole('button', { name: /speichern/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    const row = page.getByRole('row', { name: new RegExp(`Test EditPerson ${uid}`) })
    await expect(row.getByRole('button', { name: /bearbeiten/i })).toBeVisible()

    await deletePersonBySageName(request, sageName)
  })
})
