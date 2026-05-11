# Step 09 — Invoice Service

_Branch: `feature/invoice-service`_

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/projects/{id}/invoices/close` | Lock milestone and create invoice (201) |
| GET | `/projects/{id}/invoices` | List invoices for project |
| GET | `/invoices/{id}` | Get one invoice |
| GET | `/invoices/{id}/entries` | Per-person breakdown |
| PUT | `/invoices/{id}/status` | Advance status (planned→invoiced→paid) |
| DELETE | `/invoices/{id}` | Reopen month (delete invoice, unlock milestone) |

## Month-close workflow

`POST /projects/{id}/invoices/close` body: `{year, month, billing_position_id}`

1. Validates project and billing position exist and belong together
2. Fails with 409 if an invoice already exists for that project/year/month
3. Aggregates `TimeBooking.net_hours` per person for the month
4. Looks up `ProjectMembership.billing_rate_per_hour` for active memberships
5. Creates `MonthlyInvoice` (total_hours, total_amount_euros = SUM hours × rate)
6. Creates one `InvoicePersonEntry` per person with hours, rate, and amount
7. Locks the `Milestone` (is_locked=True, status=closed) if it was initialised

## Status transitions

```
planned  →  invoiced  →  paid
```
- Only forward transitions are allowed
- `planned` invoices can be reopened (DELETE); `invoiced` and `paid` cannot

## Reopen (DELETE /invoices/{id})

- Allowed only when `status == planned`
- Deletes `InvoicePersonEntry` rows, then the `MonthlyInvoice`
- Unlocks the associated `Milestone` (is_locked=False, status=open)

## Conventions

- 201 on close; 204 on reopen
- 404 when resource not found; 409 on constraint violations (already closed, invalid status)
- Invoice months with zero bookings are allowed (total_hours=0)
