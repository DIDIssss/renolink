param([ValidateSet(4,8)][int]$Threads=4,[switch]$Background)
$ErrorActionPreference='Stop'
$savedWorkers=[Environment]::GetEnvironmentVariable('UV_THREADPOOL_SIZE','Process')
$savedConcurrency=[Environment]::GetEnvironmentVariable('RENOLINK_CRYPTO_CONCURRENCY','Process')
try{
 # Process-local, before Node starts. Does not change Windows or MySQL globals.
 [Environment]::SetEnvironmentVariable('UV_THREADPOOL_SIZE',[string]$Threads,'Process')
 [Environment]::SetEnvironmentVariable('RENOLINK_CRYPTO_CONCURRENCY',[string]$Threads,'Process')
 & (Join-Path (Split-Path -Parent $PSScriptRoot) 'INICIAR_RENOLINK.ps1') -Background:$Background
}finally{
 [Environment]::SetEnvironmentVariable('UV_THREADPOOL_SIZE',$savedWorkers,'Process')
 [Environment]::SetEnvironmentVariable('RENOLINK_CRYPTO_CONCURRENCY',$savedConcurrency,'Process')
}
