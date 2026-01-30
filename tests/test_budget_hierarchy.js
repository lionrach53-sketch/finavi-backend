const http = require('http');

const BASE_URL = 'http://localhost:3000/api';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const fullPath = '/api' + path;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: fullPath,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('🧪 Test: Budget Hierarchy Barriers\n');

  // 1. Register user
  console.log('1️⃣ Créer un utilisateur avec budget par défaut...');
  const registerRes = await makeRequest('POST', '/register', {
    phoneNumber: '1234567890',
    firstName: 'Test',
    lastName: 'User',
    primaryIncomeAmount: 400000,
    primaryIncomeFrequency: 'monthly',
    createDefaultBudgets: true
  });

  if (registerRes.status !== 201) {
    console.error('❌ Erreur lors de l\'enregistrement:', registerRes.body);
    return;
  }

  const userId = registerRes.body.userId;
  console.log(`✅ Utilisateur créé: ${userId}\n`);

  // 2. Récupérer les budgets par défaut
  console.log('2️⃣ Récupérer les budgets par défaut...');
  const budgetsRes = await makeRequest('GET', `/budgets/${userId}`);
  console.log('Budgets existants:');
  budgetsRes.body.budgets.forEach(b => {
    console.log(`  - ${b.name}: ${b.amount} XOF (${b.frequency})`);
  });

  const primaryBudget = budgetsRes.body.budgets.find(b => b.frequency === 'monthly');
  const monthlyAmount = primaryBudget.amount; // 400 000
  const maxWeekly = monthlyAmount / 4; // 100 000
  const maxDaily = monthlyAmount / 28; // ~14 285

  console.log(`\n📊 Hiérarchie calculée:`);
  console.log(`  Mensuel: ${monthlyAmount} XOF`);
  console.log(`  Max hebdo: ${maxWeekly} XOF (mensuel / 4)`);
  console.log(`  Max journalier: ${maxDaily.toFixed(0)} XOF (mensuel / 28)\n`);

  // 3. Tester la création d'un budget hebdo VALIDE
  console.log('3️⃣ Créer budget hebdomadaire VALIDE (50 000 XOF < 100 000 max)...');
  const validWeeklyRes = await makeRequest('POST', '/budgets', {
    userId,
    name: 'Budget Hebdo Valide',
    amount: 50000,
    frequency: 'weekly'
  });

  if (validWeeklyRes.status === 201) {
    console.log('✅ Budget hebdomadaire créé avec succès\n');
  } else {
    console.error('❌ Erreur:', validWeeklyRes.body.message, '\n');
  }

  // 4. Tester la création d'un budget hebdo INVALIDE (trop élevé)
  console.log('4️⃣ Essayer de créer budget hebdomadaire INVALIDE (150 000 XOF > 100 000 max)...');
  const invalidWeeklyRes = await makeRequest('POST', '/budgets', {
    userId,
    name: 'Budget Hebdo Trop Élevé',
    amount: 150000,
    frequency: 'weekly'
  });

  if (invalidWeeklyRes.status === 400) {
    console.log(`✅ Rejeté correctement: "${invalidWeeklyRes.body.message}"\n`);
  } else {
    console.error('❌ Devrait avoir été rejeté mais a été accepté\n');
  }

  // 5. Tester la création d'un budget journalier VALIDE
  console.log('5️⃣ Créer budget journalier VALIDE (500 XOF < 14 285 max)...');
  const validDailyRes = await makeRequest('POST', '/budgets', {
    userId,
    name: 'Budget Journalier Valide',
    amount: 500,
    frequency: 'daily'
  });

  if (validDailyRes.status === 201) {
    console.log('✅ Budget journalier créé avec succès\n');
  } else {
    console.error('❌ Erreur:', validDailyRes.body.message, '\n');
  }

  // 6. Tester la création d'un budget journalier INVALIDE (trop élevé)
  console.log('6️⃣ Essayer de créer budget journalier INVALIDE (20 000 XOF > 14 285 max)...');
  const invalidDailyRes = await makeRequest('POST', '/budgets', {
    userId,
    name: 'Budget Journalier Trop Élevé',
    amount: 20000,
    frequency: 'daily'
  });

  if (invalidDailyRes.status === 400) {
    console.log(`✅ Rejeté correctement: "${invalidDailyRes.body.message}"\n`);
  } else {
    console.error('❌ Devrait avoir été rejeté mais a été accepté\n');
  }

  // 7. Tester l'édition du budget hebdo VALIDE à une valeur invalide
  console.log('7️⃣ Essayer de modifier budget hebdo à 200 000 XOF (> 100 000 max)...');
  const weeklyBudgetId = (await makeRequest('GET', `/budgets/${userId}`)).body.budgets
    .find(b => b.name === 'Budget Hebdo Valide')?.id;

  if (weeklyBudgetId) {
    const editWeeklyRes = await makeRequest('PUT', `/budgets/${weeklyBudgetId}`, {
      amount: 200000
    });

    if (editWeeklyRes.status === 400) {
      console.log(`✅ Modification rejetée correctement: "${editWeeklyRes.body.message}"\n`);
    } else {
      console.error('❌ Devrait avoir été rejeté mais a été accepté\n');
    }
  }

  console.log('✅ Tous les tests sont terminés!');
}

test().catch(console.error);
