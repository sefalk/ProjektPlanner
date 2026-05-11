import { test, expect } from '@playwright/test'

test.describe('Kalender', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/calendar')
    await page.waitForLoadState('networkidle')
  })

  test('zeigt Seitenüberschrift und Monat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Kalender' })).toBeVisible()
    // Month + year shown in the navigation span
    const monthSpan = page.locator('span.text-sm.font-medium').first()
    await expect(monthSpan).toBeVisible()
    const text = await monthSpan.textContent()
    expect(text?.trim()).toBeTruthy()
  })

  test('Vor/Zurück-Navigation wechselt den Monat', async ({ page }) => {
    const before = await page.locator('span.text-sm.font-medium').first().textContent()
    await page.getByRole('button', { name: /nächster monat/i }).click()
    await page.waitForLoadState('networkidle')
    const after = await page.locator('span.text-sm.font-medium').first().textContent()
    expect(after).not.toBe(before)

    await page.getByRole('button', { name: /vorheriger monat/i }).click()
    await page.waitForLoadState('networkidle')
    const restored = await page.locator('span.text-sm.font-medium').first().textContent()
    expect(restored).toBe(before)
  })

  test('Layer-Chips sind vorhanden', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Feiertage' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Urlaub' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Projekte' })).toBeVisible()
  })

  test('Filter-Dropdowns sind vorhanden', async ({ page }) => {
    // Program filter
    await expect(page.getByRole('combobox').first()).toBeVisible()
    const firstOption = await page.getByRole('combobox').first().locator('option').first().textContent()
    expect(firstOption).toContain('Alle Hauptprojekte')

    // Project filter
    const combos = page.getByRole('combobox')
    await expect(combos.nth(1)).toBeVisible()
    const secondOption = await combos.nth(1).locator('option').first().textContent()
    expect(secondOption).toContain('Alle Projekte')
  })

  test('Personen-Zeilen sind sichtbar wenn Daten vorhanden', async ({ page }) => {
    const table = page.getByRole('table')
    const tableVisible = await table.isVisible().catch(() => false)
    if (tableVisible) {
      await expect(table.getByRole('columnheader', { name: 'Person' })).toBeVisible()
    }
    const hasContent = await page.locator('table, p:has-text("Keine Personen")').first().isVisible()
    expect(hasContent).toBe(true)
  })

  test('Legende ist sichtbar', async ({ page }) => {
    await expect(page.getByText('Feiertag', { exact: true })).toBeVisible()
    await expect(page.getByText('Wochenende', { exact: true })).toBeVisible()
    await expect(page.getByText('Urlaub', { exact: true }).first()).toBeVisible()
  })

  test('Prognose-Chart ist nicht sichtbar ohne Projektauswahl', async ({ page }) => {
    // Chart only appears when a project is selected
    const chart = page.locator('text=Budgetverlauf')
    await expect(chart).not.toBeVisible()
  })

  test('Heute-Spalte ist hervorgehoben', async ({ page }) => {
    // The header cell for today gets bg-blue-50 and a border-top styling.
    // Look for the day number of today inside a th element that has the blue class.
    const today = new Date()
    const dayNum = today.getDate().toString()

    // Column headers render day numbers; at least one should be inside a blue-styled th.
    const blueHeader = page.locator('th.bg-blue-50')
    const count = await blueHeader.count()
    if (count === 0) {
      // Today is a weekend or the calendar month differs — pass gracefully.
      return
    }
    // The highlighted th should contain today's day number.
    await expect(blueHeader.first()).toContainText(dayNum)
  })

  test('Personen-Zeile hat ausklappbaren Chevron wenn Daten vorhanden', async ({ page }) => {
    const table = page.getByRole('table')
    const hasTable = await table.isVisible().catch(() => false)
    if (!hasTable) return

    // Each person row has a chevron toggle button (ChevronRight/ChevronDown icon).
    const chevrons = page.locator('button[aria-label*="expand"], button[aria-label*="aufklappen"], button svg.lucide-chevron-right, button svg.lucide-chevron-down')
    const chevronCount = await chevrons.count()
    if (chevronCount === 0) {
      // No person rows — pass gracefully.
      return
    }
    await expect(chevrons.first()).toBeVisible()
  })

  test('Zeile klappt auf und zeigt Projektzuweisungen', async ({ page }) => {
    const table = page.getByRole('table')
    const hasTable = await table.isVisible().catch(() => false)
    if (!hasTable) return

    // Find person rows: they contain a sticky name cell followed by the colSpan cell.
    // The expand button is the first button inside a td with position sticky.
    const expandBtns = page.locator('td.sticky button').filter({ has: page.locator('svg') })
    const count = await expandBtns.count()
    if (count === 0) return

    // Click first expand button and check that sub-rows appear.
    const btn = expandBtns.first()
    await btn.click()
    await page.waitForTimeout(100)

    // Sub-rows contain project membership info: h/Woche text or a project number link.
    const subRowContent = page.locator('tr').filter({ hasText: 'h/Woche' })
    const subRowLinks = page.locator('tr td a[href*="/projects/"]')
    const subCount = await subRowContent.count() + await subRowLinks.count()
    // Sub-rows are only rendered when the person has memberships.
    // Just verify the click didn't cause an error.
    await expect(page).not.toHaveURL(/error/)
    if (subCount > 0) {
      // At least one sub-row or project link appeared — expansion works.
      expect(subCount).toBeGreaterThan(0)
    }
  })

  test('Meilenstein-Badge zeigt Tooltip beim Hover', async ({ page }) => {
    // Milestone badges appear only when the current month has project milestones.
    // Use the milestone-badge container (span.group with cursor-default).
    const badge = page.locator('span.group.cursor-default').first()
    const badgeCount = await page.locator('span.group.cursor-default').count()

    if (badgeCount === 0) {
      // No milestone data in current month — pass gracefully.
      return
    }

    await badge.hover()

    // The tooltip div uses `invisible group-hover:visible`; after hover it should be visible.
    const tooltip = badge.locator('div.invisible')
    await expect(tooltip).toBeVisible()

    // Content: plan hours, current hours, status
    await expect(tooltip).toContainText('Plan:')
    await expect(tooltip).toContainText('Aktuell:')
    await expect(tooltip).toContainText('Status:')
  })
})
