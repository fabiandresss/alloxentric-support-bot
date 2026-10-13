<#
.SYNOPSIS
  Apaga lo que levanto iniciar.ps1: ventanas del API y del frontend, y los contenedores.

.PARAMETER BorrarDatos
  Ademas borra la base de datos (docker compose down -v). Sin esto los datos se conservan.
#>
[CmdletBinding()]
param([switch]$BorrarDatos)

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

# por si quedaron servidores sueltos en los puertos del proyecto
foreach ($puerto in @(8000, 3000)) {
    Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        & taskkill /PID $_.OwningProcess /T /F *> $null
        Write-Host "    [ok] liberado el puerto $puerto (PID $($_.OwningProcess))" -ForegroundColor Green
    }
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host ''
    Write-Host '==> Deteniendo Postgres y Redis' -ForegroundColor Cyan
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
Write-Host ''
