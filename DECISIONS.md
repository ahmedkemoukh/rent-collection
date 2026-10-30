# Decisions

## 5. A void reopens invoices while the lease still has `unapplied_sen` from an online payment

Nothing is moved automatically. `voidPayment` (`src/features/payments/service.ts:226-252`) sets the payment to `voided`, then deletes only that payment's allocations (line 241). The online payment keeps its `unapplied_sen` (set once, in `src/features/payments/allocation.ts:59`), and the reopened invoices show as unpaid or overdue.

Example from our tests: after voiding a cash payment, the oldest invoice is unpaid while later ones stay paid, because the other payments keep their allocations.

Why: the brief says other payments' allocations do not change, and an approved payment should not be rewritten as a side effect of voiding a different one. Reapplying credit is a money movement that deserves its own audited action by a manager ("apply unapplied credit"), which I would add next rather than hide inside void.
