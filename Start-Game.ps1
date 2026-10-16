param([int]$Port = 4180, [switch]$NoBrowser, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$url = "http://127.0.0.1:$Port/mini-civilization/"
function Test-GameServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match 'src="/mini-civilization/assets/'
    } catch { return $false }
}
if (Test-GameServer) {
    if (-not $NoBrowser) { Start-Process $url }
    Write-Output "Game is running: $url"
    exit 0
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\vite\bin\vite.js'))) {
    & npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not $SkipBuild) {
    & npm.cmd run build -- --base=/mini-civilization/
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$runtime = Join-Path $PSScriptRoot 'runtime.local'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$vite = Join-Path $PSScriptRoot 'node_modules\vite\bin\vite.js'
$argsForVite = @(('"' + $vite + '"'), 'preview', '--host', '127.0.0.1', '--port', [string]$Port, '--strictPort', '--base=/mini-civilization/')
$server = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $argsForVite -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime "server-$Port.log") -RedirectStandardError (Join-Path $runtime "server-$Port.error.log")
$server.Id | Set-Content -LiteralPath (Join-Path $runtime "server-$Port.pid")
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-GameServer) {
        if (-not $NoBrowser) { Start-Process $url }
        Write-Output "Game is running: $url"
        exit 0
    }
    if ($server.HasExited) { throw "Preview did not start. See runtime.local/server-$Port.error.log" }
    Start-Sleep -Milliseconds 200
}
throw "Preview did not respond: $url"
