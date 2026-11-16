param([switch]$Background)
$ErrorActionPreference = 'Stop'
Write-Host 'RenoLink - MySQL local (renolink_dev / renolink_app)'
$mode = if ($Background) { 'Background' } else { 'Start' }
& (Join-Path $PSScriptRoot 'scripts/mysql-dev.ps1') -Mode $mode
