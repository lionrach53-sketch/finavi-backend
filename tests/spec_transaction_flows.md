Transaction flows test spec

Purpose: validate transactional correctness, edge cases and fallback behaviour.

Tests (automatable):

1) Basic expense cascade (single transaction)
- Setup: Create user, create primary monthly budget (amount 400000), create weekly budget amount = monthly/4, create daily budget amount = weekly/7
- Action: POST /api/transactions type=expense amount=100 budgetId=daily
- Expected:
  - HTTP 201
  - JournalEntry created with affected containing daily, weekly, monthly with before/after currentAmount decreased by 100 each
  - Day.finalPocket updated
  - weekly.currentAmount decreased by 100

2) Exact ceiling
- Action: expense amount equal to budget.currentAmount
- Expected: accepted; currentAmount becomes 0; JournalEntry recorded

3) +1 XOF over ceiling
- Action: expense amount = currentAmount + 1
- Expected: rejected with 400 and message indicating negative

4) Gains do not change weekly.currentAmount
- Action: POST gain amount on any budget
- Expected: JournalEntry txType 'gain', Budget.currentAmount unchanged, Day.gains increased

5) Concurrency test
- Setup: two concurrent expense requests that together exceed currentAmount but individually below it
- Expected: one succeeds, the other fails (no negative final state). When MongoDB transactions available both succeed/one fails deterministically; with fallback, conditional updates must prevent both passing.

6) Fallback path observed
- Run the same tests against a standalone MongoDB (no replica-set)
- Expected: fallback path engages; operations produce consistent ledger (no negatives), JournalEntry records show 'cascade_expense_fallback' when applicable

7) Migration verification
- Run migration script and ensure budgets with missing initialAmount/currentAmount are updated; verify backup created

8) Day/argent_en_poche coherence
- argent_en_poche returned by /api/dashboard/:userId equals weekly.currentAmount
- budgetsAvailable equals sum of all budgets' currentAmount

Automation notes:
- Prefer using a test MongoDB replica-set for full transaction coverage (mongodb-memory-server supports replicaSet config for tests)
- Use Mocha/Jest + supertest for API calls

