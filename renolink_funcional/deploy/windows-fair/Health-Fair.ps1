param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3100,
    [switch]$Readiness,
    [switch]$AllowDatabaseRead
)

$ErrorActionPreference = 'Stop'
if ($Readiness -and -not $AllowDatabaseRead) {
    throw 'Readiness consulta o estado do MySQL. Confirme a autorizacao com -AllowDatabaseRead.'
}
if (-not $Readiness -and $AllowDatabaseRead) {
    throw '-AllowDatabaseRead so pode ser usado junto de -Readiness.'
}

$path = if ($Readiness) { '/health/ready' } else { '/health/live' }
$headers = @{
    'X-Forwarded-For' = '192.0.2.1'
    'X-Forwarded-Proto' = 'https'
}
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 `
        -Uri "http://127.0.0.1:$Port$path" -Headers $headers
    $watch.Stop()
    $body = $response.Content | ConvertFrom-Json
    $ok = $response.StatusCode -eq 200 -and $body.ok -eq $true
    [PSCustomObject]@{
        ok = $ok
        status = [int]$response.StatusCode
        durationMs = $watch.ElapsedMilliseconds
        check = if ($Readiness) { 'readiness' } else { 'liveness' }
    } | ConvertTo-Json -Compress
    if (-not $ok) { exit 1 }
}
catch {
    $watch.Stop()
    [Console]::Error.WriteLine('Health check local falhou; nenhum detalhe de conexao foi exibido.')
    exit 1
}
