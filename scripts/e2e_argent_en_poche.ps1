$ErrorActionPreference = 'Stop'
$api = 'http://localhost:3000/api'
Write-Output "Starting E2E check against $api"

# 1) register user
$phone = "9990001"
$body = @{ phoneNumber = $phone; firstName = 'E2E'; lastName = 'Tester'; primaryIncomeAmount = 400000; primaryIncomeFrequency = 'monthly' } | ConvertTo-Json
$reg = Invoke-RestMethod -Uri "$api/register" -Method Post -Body $body -ContentType 'application/json'
$userId = $reg.userId
Write-Output "Created user: $userId"

# 2) fetch dashboard before
Write-Output '--- DASHBOARD BEFORE ---'
$dashBefore = Invoke-RestMethod -Uri "$api/dashboard/$userId"
$dashBefore | ConvertTo-Json -Depth 4
$argentBefore = $dashBefore.argent_en_poche
Write-Output "argent_en_poche BEFORE: $argentBefore"

# 3) ensure there is a daily or weekly budget to charge; fetch budgets
$budgets = Invoke-RestMethod -Uri "$api/budgets/$userId"
$bud = $budgets.budgets | Where-Object { $_.frequency -eq 'daily' } | Select-Object -First 1
if (-not $bud) {
  Write-Output 'No daily budget found — creating one (Micro-test)'
  $bbody = @{ userId = $userId; name = 'E2E Daily'; amount = 1500; frequency = 'daily' } | ConvertTo-Json
  $bresp = Invoke-RestMethod -Uri "$api/budgets" -Method Post -Body $bbody -ContentType 'application/json'
  $bud = $bresp.budget
  Write-Output "Created budget: $($bud.id)"
}
$budgetId = $bud.id
Write-Output "Using budgetId: $budgetId (freq: $($bud.frequency) amount: $($bud.amount))"

# 4) post a daily expense of 1500
$txBody = @{ userId = $userId; type = 'expense'; amount = 1500; comment = 'E2E daily test'; budgetId = $budgetId } | ConvertTo-Json
$tx = Invoke-RestMethod -Uri "$api/transactions" -Method Post -Body $txBody -ContentType 'application/json'
Write-Output "Created transaction: $($tx.transaction ? $tx.transaction.id : ($tx | ConvertTo-Json -Depth 2))"

# 5) fetch dashboard after
Write-Output '--- DASHBOARD AFTER ---'
$dashAfter = Invoke-RestMethod -Uri "$api/dashboard/$userId"
$dashAfter | ConvertTo-Json -Depth 4
$argentAfter = $dashAfter.argent_en_poche
Write-Output "argent_en_poche AFTER: $argentAfter"

# 6) fetch day and transactions
Write-Output '--- DAY ---'
$day = Invoke-RestMethod -Uri "$api/days/$userId"
$day | ConvertTo-Json -Depth 6

# Quick assertion
if ($argentAfter -lt $argentBefore) { Write-Output 'E2E: argent_en_poche decreased as expected.' } else { Write-Output 'E2E: argent_en_poche did NOT decrease — investigate.' ; exit 2 }

Write-Output 'E2E check completed.'
