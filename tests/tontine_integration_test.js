const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const assert = require('assert');

const API = process.env.API_BASE || 'http://localhost:3000/api';

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function run(){
  console.log('Starting tontine integration test against', API);

  // 1) Create a test user via register (uses phone-based create)
  const phone = `testuser${Date.now()}`;
  let resp = await fetch(`${API}/register`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phoneNumber: phone, firstName: 'Test', lastName: 'User', primaryIncomeAmount: 1000 }) });
  const created = await resp.json();
  assert(resp.ok, 'User creation failed: ' + JSON.stringify(created));
  const userId = created.user ? created.user.id : created.userId;
  console.log('Created user', userId);

  // 2) Create a budget to attach tontine
  resp = await fetch(`${API}/budgets`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId, name: 'Tontine budget', amount: 100000, frequency: 'monthly' }) });
  const b = await resp.json();
  assert(resp.ok && b.success, 'Budget create failed');
  const budgetId = b.budget ? b.budget.id : b.data?.id || b.budgetId || null;
  console.log('Created budget', budgetId);

  // 3) Create tontine with 4 participants, this user position 2
  resp = await fetch(`${API}/tontines`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId, name: 'Office Tontine', contributionAmount: 1000, startDate: new Date().toISOString().split('T')[0], frequency: 'monthly', budgetId, participantsCount:4, myPosition:2 }) });
  const t = await resp.json();
  assert(resp.ok && t.success, 'Tontine create failed: ' + JSON.stringify(t));
  const tontineId = t.tontine.id || t.tontineId || t.data?.id;
  console.log('Created tontine', tontineId);

  // 4) Join another user to ensure members > 1
  // create second user
  resp = await fetch(`${API}/register`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phoneNumber: phone + '-2', firstName: 'Other', lastName: 'User' }) });
  const created2 = await resp.json();
  assert(resp.ok, 'User2 creation failed');
  const user2 = created2.user ? created2.user.id : created2.userId;
  console.log('Created user2', user2);

  resp = await fetch(`${API}/tontines/${tontineId}/join`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: user2 }) });
  const joinRes = await resp.json();
  assert(resp.ok && joinRes.success, 'Join failed: ' + JSON.stringify(joinRes));
  console.log('User2 joined tontine');

  // 5) Contribute from user (should create transaction and update Day)
  resp = await fetch(`${API}/tontines/${tontineId}/contribute`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId, amount: 1000 }) });
  const contrib = await resp.json();
  assert(resp.ok && contrib.success, 'Contribute failed: ' + JSON.stringify(contrib));
  console.log('Contribution accepted, totalAmount:', contrib.totalAmount);

  // 6) Fetch tontine details and ensure member contributed updated
  resp = await fetch(`${API}/tontines/id/${tontineId}`);
  const details = await resp.json();
  assert(resp.ok && details.success, 'Fetch tontine details failed');
  const me = details.tontine.members.find(m => m.userId === userId || m.userId === String(userId));
  assert(me && me.contributed >= 1000, 'Member contribution not recorded');
  console.log('Member contribution present in tontine');

  // 7) Verify Day recalculation: fetch dashboard and ensure today's transactions include the tontine expense
  let dash;
  let tontineTx = null;
  const start = Date.now();
  const timeout = 5000; // ms
  while (Date.now() - start < timeout) {
    resp = await fetch(`${API}/dashboard/${userId}`);
    dash = await resp.json();
    if (resp.ok && dash.user) {
      const txs = dash.transactions || [];
      tontineTx = txs.find(t => t.comment && t.comment.includes('Tontine'));
      if (tontineTx) break;
    }
    await sleep(500);
  }
  assert(tontineTx, 'Tontine transaction not present in dashboard transactions after retrying');
  console.log('Tontine transaction visible in dashboard transactions');

  // 8) Call percent endpoint
  resp = await fetch(`${API}/tontines/${tontineId}/percent/${userId}`);
  const p = await resp.json();
  assert(resp.ok && p.success, 'Percent endpoint failed');
  console.log('PercentUntilMyTurn:', p.percentUntilMyTurn, 'turnsUntilMe:', p.turnsUntilMe);

  console.log('\nAll tests passed.');
}

run().catch(err => { console.error('Test failed:', err); process.exit(1); });
