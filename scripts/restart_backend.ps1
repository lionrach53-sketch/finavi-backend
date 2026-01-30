$ErrorActionPreference = 'Stop'
$p = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess
if ($p) {
  Write-Output "Killing pid $p"
  Stop-Process -Id $p -Force
}
Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\BNT\Documents\PROJET FINAVI\finavii\coach-financier-backend' -NoNewWindow
Write-Output 'Backend restart requested.'
