<#
.SYNOPSIS
  Apaga lo que levanto iniciar.ps1: ventanas del API y del frontend, y los contenedores.

.PARAMETER BorrarDatos
  Ademas borra la base de datos (docker compose down -v). Sin esto los datos se conservan.
#>
[CmdletBinding()]
param(
    [switch]$BorrarDatos,
    [switch]$SoloProcesos   # no toca Docker (lo usa iniciar.ps1 -Reset)
)

$ErrorActionPreference = 'Continue'
$Raiz = $PSScriptRoot
$Run  = Join-Path $Raiz '.run'

Write-Host ''
Write-Host '==> Deteniendo servidores' -ForegroundColor Cyan
foreach ($nombre in @('api', 'front')) {
    $f = Join-Path $Run "$nombre.pid"
    if (Test-Path $f) {
        $id = (Get-Content $f | Select-Object -First 1)
        if ($id -match '^\d+$') {
            # /T mata tambien los procesos hijos (uvicorn, node)
            & taskkill /PID $id /T /F *> $null
            Write-Host "    [ok] $nombre detenido (PID $id)" -ForegroundColor Green
        }
        Remove-Item $f -Force -ErrorAction SilentlyContinue
    }
}

# Postgres embebido (-SinDocker): primero un apagado LIMPIO. Matarlo a la fuerza obliga a recuperacion al reiniciar
# (en algunos discos con antivirus tarda mas de 30 s y dev_db.py falla por tiempo de espera).
$datos = Join-Path $Raiz 'backend\.pgdata'
if (Test-Path (Join-Path $datos 'postmaster.pid')) {
    $ctl = Get-ChildItem (Join-Path $Raiz 'backend\.venv\Lib\site-packages\pixeltable_pgserver') -Recurse -Filter pg_ctl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ctl) {
        & $ctl.FullName -D $datos stop -m fast -w -t 60 *> $null
        if ($LASTEXITCODE -eq 0) { Write-Host '    [ok] Postgres embebido apagado de forma limpia' -ForegroundColor Green }
    }
}
foreach ($nombre in @('db')) {
    $f = Join-Path $Run "$nombre.pid"
    if (Test-Path $f) {
        $id = (Get-Content $f | Select-Object -First 1)
        if ($id -match '^\d+$') { & taskkill /PID $id /T /F *> $null; Write-Host "    [ok] dev_db.py detenido (PID $id)" -ForegroundColor Green }
        Remove-Item $f -Force -ErrorAction SilentlyContinue
    }
}
# lo que haya quedado suelto:
Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '\.pgdata' } | ForEach-Object {
        & taskkill /PID $_.ProcessId /T /F *> $null
        Write-Host "    [ok] Postgres embebido detenido (PID $($_.ProcessId))" -ForegroundColor Green
    }
Remove-Item (Join-Path $Run 'db.url') -Force -ErrorAction SilentlyContinue   # el puerto cambia en cada arranque

# por si quedaron servidores sueltos en los puertos del proyecto
foreach ($puerto in @(8000, 3000)) {
    Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        & taskkill /PID $_.OwningProcess /T /F *> $null
        Write-Host "    [ok] liberado el puerto $puerto (PID $($_.OwningProcess))" -ForegroundColor Green
    }
}

if (-not $SoloProcesos -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host '==> Deteniendo Postgres y Redis (Docker)' -ForegroundColor Cyan
    Push-Location $Raiz
    try {
        if ($BorrarDatos) {
            & docker compose down -v
            Write-Host '    [ok] contenedores y base de datos eliminados' -ForegroundColor Yellow
        } else {
            & docker compose down
            Write-Host '    [ok] contenedores detenidos (los datos se conservan)' -ForegroundColor Green
        }
    } finally { Pop-Location }
}
if ($BorrarDatos -and -not $SoloProcesos) {
    Remove-Item -Recurse -Force (Join-Path $Raiz 'backend\.pgdata') -ErrorAction SilentlyContinue
}
Write-Host ''
