#!/usr/bin/env node

// Test E2E : vérifier que les dépenses en cascade réduisent jour/semaine/mois

const http = require('http');

const API_BASE = 'http://localhost:3000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('🧪 E2E Test: Budget Cascade\n');
  
  try {
    // 1. Register user with default budgets
    console.log('1️⃣  Registering user with default budgets...');
    const regRes = await request('POST', '/api/register', {
      phoneNumber: '5551234567',
      name: 'Test User',
      createDefaultBudgets: true
    });
    const userId = regRes.userId;
    console.log(`✅ User registered: ${userId}\n`);

    // 2. Fetch initial budgets
    console.log('2️⃣  Fetching initial budgets...');
    const daysRes = await request('GET', `/api/days/${userId}`);
    console.log('Budgets before expense:');
    daysRes.budgets.forEach(b => {
      const remaining = b.remainingToday || b.remainingThisWeek || b.remainingThisMonth;
      console.log(`  - ${b.name} (${b.frequency}): ${b.amount} XOF → ${remaining} remaining`);
    });
    console.log();

    // 3. Find daily budget
    const dailyBudget = daysRes.budgets.find(b => b.frequency === 'daily');
    if (!dailyBudget) {
      console.error('❌ No daily budget found');
      process.exit(1);
    }

    // 4. Post expense on daily budget
    console.log('3️⃣  Posting expense of 100 XOF on daily budget...');
    const txRes = await request('POST', '/api/transactions', {
      userId,
      type: 'expense',
      amount: 100,
      comment: 'Test cascade',
      budgetId: dailyBudget.id,
      transactionDate: new Date().toISOString().split('T')[0]
    });
    console.log(`✅ Transaction created: ${txRes.transaction.id}\n`);

    // 5. Fetch budgets again
    console.log('4️⃣  Fetching budgets after expense...');
    const days2Res = await request('GET', `/api/days/${userId}`);
    console.log('Budgets after 100 XOF expense:');
    days2Res.budgets.forEach(b => {
      const remaining = b.remainingToday || b.remainingThisWeek || b.remainingThisMonth;
      const initial = b.amount;
      const diff = initial - remaining;
      console.log(`  - ${b.name} (${b.frequency}): ${initial} XOF → ${remaining} remaining (−${diff})`);
    });
    console.log();

    // 6. Verify cascade
    console.log('5️⃣  Verifying cascade...');
    const dailyAfter = days2Res.budgets.find(b => b.frequency === 'daily');
    const weeklyAfter = days2Res.budgets.find(b => b.frequency === 'weekly');
    const monthlyAfter = days2Res.budgets.find(b => b.frequency === 'monthly');

    const dailyReduced = dailyBudget.remainingToday - dailyAfter.remainingToday;
    const weeklyReduced = daysRes.budgets.find(b => b.frequency === 'weekly').remainingThisWeek - weeklyAfter.remainingThisWeek;
    const monthlyReduced = daysRes.budgets.find(b => b.frequency === 'monthly').remainingThisMonth - monthlyAfter.remainingThisMonth;

    console.log(`Daily reduced by: ${dailyReduced} XOF (expected 100)`);
    console.log(`Weekly reduced by: ${weeklyReduced} XOF (expected 100)`);
    console.log(`Monthly reduced by: ${monthlyReduced} XOF (expected 100)`);

    if (dailyReduced === 100 && weeklyReduced === 100 && monthlyReduced === 100) {
      console.log('\n✅ CASCADE TEST PASSED: All budgets reduced by the same amount');
      process.exit(0);
    } else {
      console.log('\n❌ CASCADE TEST FAILED: Budgets not reduced uniformly');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

test();
