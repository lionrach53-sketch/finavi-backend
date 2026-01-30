import fetch from 'node-fetch';

const API = 'http://localhost:3000/api';

async function run() {
  console.log('Starting E2E check against', API);
  // 1) register
  const phone = '999' + String(Date.now()).slice(-6);
  const regResp = await fetch(`${API}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: phone, firstName: 'E2E', lastName: 'Tester', primaryIncomeAmount: 400000, primaryIncomeFrequency: 'monthly' }) });
  const reg = await regResp.json();
  let userId;
  if (regResp.status === 201 && reg.userId) {
    userId = reg.userId;
    console.log('Created user:', userId);
  } else if (regResp.status === 409) {
    // user exists — fetch by phone
    console.log('User exists, fetching by phone...');
    const uResp = await fetch(`${API}/user-by-phone/${phone}`);
    const ujson = await uResp.json();
    userId = ujson.user.id;
    console.log('Resolved existing user id:', userId);
  } else {
    console.error('Registration failed:', reg);
    process.exit(1);
  }

  // 2) dashboard before
  console.log('--- DASHBOARD BEFORE ---');
  const dashBeforeResp = await fetch(`${API}/dashboard/${userId}`);
  const dashBefore = await dashBeforeResp.json();
  console.log(JSON.stringify(dashBefore, null, 2));
  const argentBefore = dashBefore.argent_en_poche;
  console.log('argent_en_poche BEFORE:', argentBefore);

  // 3) get budgets
  const budgetsResp = await fetch(`${API}/budgets/${userId}`);
  const budgetsData = await budgetsResp.json();
  let bud = (budgetsData.budgets || []).find(b => b.frequency === 'daily');
  if (!bud) {
    console.log('No daily budget found - creating one');
    const bResp = await fetch(`${API}/budgets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, name: 'E2E Daily', amount: 1500, frequency: 'daily' }) });
    const bjson = await bResp.json();
    bud = bjson.budget;
    console.log('Created budget', bud.id);
  }
  const budgetId = bud.id;
  console.log('Using budgetId:', budgetId, 'freq:', bud.frequency, 'amount:', bud.amount);

  // 4) post transaction
  const txResp = await fetch(`${API}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, type: 'expense', amount: 1500, comment: 'E2E daily test', budgetId }) });
  const txJson = await txResp.json();
  console.log('Transaction response:', txJson);

  // 5) dashboard after
  console.log('--- DASHBOARD AFTER ---');
  const dashAfterResp = await fetch(`${API}/dashboard/${userId}`);
  const dashAfter = await dashAfterResp.json();
  console.log(JSON.stringify(dashAfter, null, 2));
  const argentAfter = dashAfter.argent_en_poche;
  console.log('argent_en_poche AFTER:', argentAfter);

  // 6) day
  console.log('--- DAY ---');
  const dayResp = await fetch(`${API}/days/${userId}`);
  const dayJson = await dayResp.json();
  console.log(JSON.stringify(dayJson, null, 2));

  if (typeof argentBefore === 'number' && typeof argentAfter === 'number' && argentAfter < argentBefore) {
    console.log('E2E: argent_en_poche decreased as expected.');
    process.exit(0);
  } else {
    console.error('E2E: argent_en_poche did NOT decrease. Before:', argentBefore, 'After:', argentAfter);
    process.exit(2);
  }
}

run().catch(e => { console.error('E2E script error', e); process.exit(1); });
