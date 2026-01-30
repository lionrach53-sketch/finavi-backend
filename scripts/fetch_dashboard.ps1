$ErrorActionPreference = 'Stop'
$admin = Invoke-RestMethod -Uri 'http://localhost:3000/api/admin/users' -ErrorAction Stop
if (-not $admin.users -or $admin.users.Count -eq 0) {
  Write-Output 'NO_USERS'
} else {
  $id = $admin.users[0].id
  Write-Output ("USERID:" + $id)
  Write-Output '--- DASHBOARD ---'
  Invoke-RestMethod -Uri "http://localhost:3000/api/dashboard/$id" | ConvertTo-Json -Depth 6
  Write-Output '--- DAY ---'
  Invoke-RestMethod -Uri "http://localhost:3000/api/days/$id" | ConvertTo-Json -Depth 6
}
