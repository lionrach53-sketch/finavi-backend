/*
Non-destructive migration script
- Exporte les budgets qui n'ont pas `initialAmount` ou `currentAmount` dans un fichier backup JSON
- Met ensuite à jour ces budgets en définissant initialAmount = amount et currentAmount = amount

Usage (depuis coach-financier-backend):
node scripts/migrate_populate_initial_current.js

Prereqs: NODE_ENV and MONGODB_URI as usual. The script will prompt (console) before applying updates.
*/

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coach-financier';

async function run() {
  console.log('Connecting to', MONGODB_URI);
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected');

  const budgetSchema = new mongoose.Schema({}, { strict: false });
  const Budget = mongoose.model('Budget_migrate', budgetSchema, 'budgets');

  // Find budgets missing initialAmount or currentAmount
  const query = { $or: [ { initialAmount: { $exists: false } }, { currentAmount: { $exists: false } } ] };
  const docs = await Budget.find(query).lean();
  if (!docs.length) {
    console.log('No budgets missing initialAmount/currentAmount found. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(__dirname, `budgets_backup_${ts}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(docs, null, 2));
  console.log(`Exported ${docs.length} budget(s) to ${backupFile}`);

  // Confirm
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question('Apply migration (set initialAmount/currentAmount = amount) to these budgets? (yes/no): ', res));
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Aborted by user. No changes applied.');
    await mongoose.disconnect();
    return;
  }

  // Apply updates
  let updated = 0;
  for (const d of docs) {
    const id = d._id;
    const amount = Number(d.amount || d.initialAmount || d.currentAmount || 0);
    const set = {};
    if (typeof d.initialAmount === 'undefined') set.initialAmount = amount;
    if (typeof d.currentAmount === 'undefined') set.currentAmount = amount;
    if (Object.keys(set).length) {
      await Budget.updateOne({ _id: id }, { $set: set });
      updated++;
    }
  }

  console.log(`Applied updates to ${updated} budget(s).`);
  console.log('Migration completed. Keep the backup file safe.');
  await mongoose.disconnect();
}

run().catch(err => { console.error('Migration error', err); process.exit(1); });
