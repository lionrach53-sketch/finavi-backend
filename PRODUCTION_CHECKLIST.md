Production checklist - Coach Financier Backend

1) MongoDB
- Ensure MongoDB runs as a replica-set (transactions required).
- Verify `MONGODB_URI` points to the replica-set primary or connection string with `replicaSet` parameter.
- On startup the server checks transaction support; if not supported and `NODE_ENV=production` the process will exit.

2) Backup & Migration
- Run `node scripts/migrate_populate_initial_current.js` to populate missing `initialAmount`/`currentAmount`.
- Keep the created backup JSON file safe before making changes.

3) Environment
- NODE_ENV=production
- Set `MONGODB_URI`, `CORS_ORIGIN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (optional), `OPENAI_API_KEY` (optional)

4) Testing
- Run unit tests covering transaction flows (see tests/spec_transaction_flows.md)
- Test edge cases locally against a replica-set instance:
  - Expense equal to budget currentAmount (must succeed)
  - Expense amount = currentAmount + 1 (must be rejected)
  - Concurrent expenses approaching same budget (simulate race)
  - Gains must not increase weekly.currentAmount
  - Rollover: verify expected behaviour on week/month boundary (no automatic reset unless migration/process present)

5) Monitoring & Alerts
- Monitor logs for transaction failures and JournalEntry rejections
- Alert if `TRANSACTIONS_SUPPORTED` is false in production
- Track counts of JournalEntry with ruleApplied 'cascade_expense' and fallback variants

6) Deployment
- Start services behind a process supervisor (systemd, PM2)
- Expose health endpoint `/api` for readiness checks
- Run smoke test: POST /api/register (test account), POST /api/budgets, POST /api/transactions (expense), GET /api/dashboard/:userId

7) Rollback strategy
- Keep DB backups (mongodump) before mass operations
- Use JournalEntry collection for forensic rollback if needed

8) Post-deploy checklist
- Validate a sample user: create budget primary, weekly, daily; perform expense in daily and verify weekly.currentAmount decremented correctly and Day.finalPocket coherent.

