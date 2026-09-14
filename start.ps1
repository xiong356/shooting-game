Set-Location -Path $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Valorant Training Range Server" -ForegroundColor Cyan
Write-Host "http://127.0.0.1:3000" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Cyan

if (Get-Command node -ErrorAction SilentlyContinue) {
    node server.js
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    python -m http.server 3000 --bind 127.0.0.1
} else {
    Write-Host "ERROR: node or python not found." -ForegroundColor Red
    Write-Host "Please install Node.js or Python."
    Read-Host "Press Enter to exit"
}
