<#
.SYNOPSIS
  Levanta TODO el proyecto en tu maquina (Windows): base de datos, backend y frontend.

.DESCRIPTION
  Es idempotente: puedes correrlo cuantas veces quieras; solo hace lo que falta.
    1. Revisa Docker, Python y Node.
    2. Crea el .env con claves aleatorias si no existe (nunca pisa uno existente).
    3. Levanta Postgres+pgvector y Redis (docker compose) y espera a que respondan.
    4. Backend: crea el .venv, instala dependencias (solo si cambiaron), migra y siembra datos de ejemplo (solo si la BD esta vacia).
    5. Frontend: npm install (solo si cambio) y arranque.
    6. Abre cada servidor en su ventana y el navegador en http://localhost:3000

  Para apagar: .\detener.ps1   (o detener.cmd)

.PARAMETER Reset
  Borra la base de datos (docker compose down -v) y la vuelve a sembrar desde cero.
.PARAMETER SinFrontend
  Levanta solo base de datos y backend.
.PARAMETER NoAbrirNavegador
  No abre el navegador al terminar.
.PARAMETER SoloConfigurar
  Solo crea/revisa el .env y termina.
.PARAMETER Simular
  Muestra lo que haria sin ejecutar nada.

.EXAMPLE
  .\iniciar.ps1
.EXAMPLE
  .\iniciar.ps1 -Reset
#>
[CmdletBinding()]
param(
    [switch]$Reset,
    [switch]$SinFrontend,
    [switch]$NoAbrirNavegador,
    [switch]$SoloConfigurar,
    [switch]$Simular
)

$ErrorActionPreference = 'Stop'
$Raiz   = $PSScriptRoot
$Back   = Join-Path $Raiz 'backend'
$Front  = Join-Path $Raiz 'frontend'
$Run    = Join-Path $Raiz '.run'
$EnvRaiz = Join-Path $Raiz '.env'
$Py     = Join-Path $Back '.venv\Scripts\python.exe'

# ---------------------------------------------------------------- utilidades
function Paso($t)  { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "    [ok] $t" -ForegroundColor Green }
function Info($t)  { Write-Host "    $t" -ForegroundColor Gray }
function Aviso($t) { Write-Host "    [!] $t" -ForegroundColor Yellow }
function Fallo($t) { Write-Host ""; Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }

function Hacer([string]$descripcion, [scriptblock]$bloque) {
    if ($Simular) { Info "(simulacion) $descripcion"; return }
    & $bloque
}

function Verificar-Salida([string]$que) {
    if ($LASTEXITCODE -ne 0) { Fallo "$que fallo (codigo $LASTEXITCODE). Revisa el mensaje de arriba." }
}

function Secreto([int]$largo) {
    # solo letras y numeros: seguro para usar dentro de una URL (DATABASE_URL)
    $sal = ''
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    while ($sal.Length -lt $largo) {
        $b = New-Object byte[] 48
        $rng.GetBytes($b)
        $sal += ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', '')
    }
    return $sal.Substring(0, $largo)
}

function Puerto-Ocupado([int]$p) {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Copiar-Si-Falta([string]$origen, [string]$destino) {
    if ((Test-Path $destino)) { return $false }
    Copy-Item $origen $destino
    return $true
}

# ---------------------------------------------------------------- 1. requisitos
Paso 'Revisando requisitos'
if ($Simular) {
    Info '(simulacion) se omite la revision de Docker/Python/Node'
} elseif (-not $SoloConfigurar) {
    foreach ($c in @(@('docker', 'Docker Desktop (https://www.docker.com/products/docker-desktop), abrelo y espera a que diga Running'),
                     @('python', 'Python 3.11 o superior (https://www.python.org/downloads/), marcando "Add to PATH"'),
                     @('node',   'Node.js 20 o superior (https://nodejs.org/)'))) {
        if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { Fallo "Falta '$($c[0])'. Instala $($c[1])" }
    }
    $v = (& python --version) 2>&1
    if ($v -notmatch 'Python 3\.(\d+)' -or [int]$Matches[1] -lt 11) { Fallo "Se necesita Python 3.11 o superior (tienes: $v)" }
    Ok "$v | Node $(& node --version) | $((& docker --version))"
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { Fallo 'Docker esta instalado pero no esta corriendo. Abre Docker Desktop, espera a que diga "Running" y reintenta.' }
    Ok 'Docker Desktop esta corriendo'
} else {
    Info 'solo configuracion: no se revisan Docker/Python/Node'
}

# ---------------------------------------------------------------- 2. .env
Paso 'Configuracion (.env)'
$ejemplo = Join-Path $Raiz '.env.example'
if (-not (Test-Path $ejemplo)) { Fallo "No encuentro $ejemplo. Ejecuta el script desde la carpeta del proyecto." }

if (Test-Path $EnvRaiz) {
    Ok '.env ya existe: no se modifica'
} elseif ($Simular) {
    Info '(simulacion) se crearia .env con DB_PASSWORD, JWT_SECRET y SUPERADMIN_PASSWORD aleatorios'
} else {
    $dbPass  = Secreto 24
    $jwt     = Secreto 64
    $superPw = Secreto 16
    $lineas = foreach ($l in (Get-Content $ejemplo)) {
        if     ($l -match '^DB_PASSWORD=')         { "DB_PASSWORD=$dbPass" }
        elseif ($l -match '^DATABASE_URL=')        { "DATABASE_URL=postgresql+psycopg://chatbot:$dbPass@127.0.0.1:5432/chatbot_soporte" }
        elseif ($l -match '^JWT_SECRET=')          { "JWT_SECRET=$jwt" }
        elseif ($l -match '^SUPERADMIN_PASSWORD=') { "SUPERADMIN_PASSWORD=$superPw" }
        else   { $l }
    }
    # UTF-8 sin BOM (docker compose y python-dotenv lo leen sin problemas)
    [IO.File]::WriteAllLines($EnvRaiz, [string[]]$lineas, (New-Object Text.UTF8Encoding($false)))
    Ok '.env creado con claves aleatorias'
    Write-Host ''
    Write-Host '    Superadmin del panel:' -ForegroundColor White
    Write-Host '      correo: superadmin@alloxentric.local'
    Write-Host "      clave : $superPw    (queda guardada en .env como SUPERADMIN_PASSWORD)"
    Write-Host ''
    Aviso 'Si tienes una clave de DeepSeek, agregala en .env como DEEPSEEK_API_KEY=... (sin ella el bot responde con el fragmento mas relevante).'
}
if ($SoloConfigurar) { Ok 'Listo (solo configuracion).'; exit 0 }

# ---------------------------------------------------------------- 3. base de datos
Paso 'Base de datos (Postgres + pgvector, Redis)'
Push-Location $Raiz
try {
    if ($Reset) {
        Aviso 'Reset: se borra la base de datos y se vuelve a sembrar.'
        Hacer 'docker compose down -v' { & docker compose down -v; Verificar-Salida 'docker compose down' }
    }
    Hacer 'docker compose up -d' { & docker compose up -d; Verificar-Salida 'docker compose up' }
    Hacer 'esperar a Postgres' {
        $listo = $false
        for ($i = 0; $i -lt 60; $i++) {
            & docker compose exec -T db pg_isready -U chatbot -d chatbot_soporte *> $null
            if ($LASTEXITCODE -eq 0) { $listo = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $listo) { Fallo 'Postgres no respondio en 60 s. Mira: docker compose logs db' }
        Ok 'Postgres responde'
    }
} finally { Pop-Location }

# ---------------------------------------------------------------- 4. backend
Paso 'Backend (Python)'
Push-Location $Back
try {
    if (-not (Test-Path $Py)) {
        Hacer 'python -m venv .venv' { & python -m venv .venv; Verificar-Salida 'crear el entorno virtual' }
    } else { Ok 'entorno virtual .venv ya existe' }

    $marca = Join-Path $Back '.venv\.requirements.hash'
    $hashReq = (Get-FileHash (Join-Path $Back 'requirements.txt')).Hash
    if ((Test-Path $marca) -and ((Get-Content $marca -ErrorAction SilentlyContinue) -eq $hashReq)) {
        Ok 'dependencias al dia'
    } else {
        Info 'instalando dependencias (la primera vez baja torch, ~1 GB: puede tardar varios minutos)...'
        Hacer 'pip install -r requirements.txt' {
            & $Py -m pip install --disable-pip-version-check -r requirements.txt
            Verificar-Salida 'pip install'
            Set-Content -Path $marca -Value $hashReq
        }
    }

    Hacer 'alembic upgrade head' { & $Py -m alembic upgrade head; Verificar-Salida 'alembic upgrade head'; Ok 'esquema de BD al dia' }

    Hacer 'sembrar datos si la BD esta vacia' {
        $n = & $Py -c "from app.db import SessionLocal; from app import models as m; from sqlalchemy import select, func; s = SessionLocal(); print(s.scalar(select(func.count()).select_from(m.Empresa)))"
        Verificar-Salida 'consultar la BD'
        if ($Reset -or [int]$n -eq 0) {
            $args2 = @('seed.py'); if ($Reset) { $args2 += '--reset' }
            & $Py @args2
            Verificar-Salida 'seed.py'
            Ok 'datos de ejemplo cargados (API keys en backend\seed_keys.txt)'
        } else {
            Ok "la BD ya tiene $n empresa(s): no se siembra"
        }
    }
} finally { Pop-Location }

# ---------------------------------------------------------------- 5. frontend
if (-not $SinFrontend) {
    Paso 'Frontend (React)'
    Push-Location $Front
    try {
        if ($Simular) { Info '(simulacion) se crearia frontend\.env desde .env.example' }
        elseif (Copiar-Si-Falta (Join-Path $Front '.env.example') (Join-Path $Front '.env')) { Ok 'frontend\.env creado' }
        $marcaF = Join-Path $Front 'node_modules\.package-lock.hash'
        $hashF = (Get-FileHash (Join-Path $Front 'package-lock.json')).Hash
        if ((Test-Path $marcaF) -and ((Get-Content $marcaF -ErrorAction SilentlyContinue) -eq $hashF)) {
            Ok 'dependencias al dia'
        } else {
            Hacer 'npm install' {
                & npm install --no-audit --no-fund
                Verificar-Salida 'npm install'
                Set-Content -Path $marcaF -Value $hashF
            }
        }
    } finally { Pop-Location }
}

# ---------------------------------------------------------------- 6. arranque
Paso 'Arrancando servidores'
if (-not $Simular) {
    New-Item -ItemType Directory -Force -Path $Run | Out-Null
    foreach ($par in @(@(8000, 'API (backend)'), @(3000, 'frontend'))) {
        if (($par[0] -eq 3000 -and $SinFrontend)) { continue }
        if (Puerto-Ocupado $par[0]) {
            Aviso "El puerto $($par[0]) ya esta en uso ($($par[1])). Si es un arranque anterior, ejecuta .\detener.ps1 y vuelve a correr este script."
        }
    }
}

function Abrir-Ventana([string]$titulo, [string]$carpeta, [string]$comando, [string]$archivoPid) {
    $cmd = "`$Host.UI.RawUI.WindowTitle = '$titulo'; $comando"
    $p = Start-Process powershell -PassThru -WorkingDirectory $carpeta -ArgumentList @('-NoExit', '-NoProfile', '-Command', "`"$cmd`"")
    Set-Content -Path (Join-Path $Run $archivoPid) -Value $p.Id
    Ok "$titulo en su propia ventana (PID $($p.Id))"
}

Hacer 'iniciar la API en :8000' {
    Abrir-Ventana 'API - Alloxentric (:8000)' $Back "& '$Py' -m uvicorn app.main:app --reload" 'api.pid'
}
if (-not $SinFrontend) {
    Hacer 'iniciar el frontend en :3000' {
        Abrir-Ventana 'Frontend - Alloxentric (:3000)' $Front 'npm run dev' 'front.pid'
    }
}

if (-not $Simular) {
    Info 'esperando a la API...'
    $arriba = $false
    for ($i = 0; $i -lt 90; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8000/health' -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $arriba = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if ($arriba) { Ok 'API arriba: http://localhost:8000/docs' } else { Aviso 'La API no respondio en 90 s: revisa su ventana.' }
}

# ---------------------------------------------------------------- resumen
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Green
Write-Host $(if ($Simular) { ' Simulacion terminada (no se ejecuto nada)' } else { ' Listo' }) -ForegroundColor Green
Write-Host '======================================================================' -ForegroundColor Green
Write-Host '  Panel          http://localhost:3000'
Write-Host '  Chat publico   http://localhost:3000/chat/wellq   (requiere agente publicado)'
Write-Host '  API / docs     http://localhost:8000/docs'
Write-Host '  Estado         http://localhost:8000/health'
Write-Host ''
Write-Host '  Usuarios demo (clave Demo1234!):  admin@wellq.demo  tickets@wellq.demo  agente@wellq.demo'
Write-Host '  Superadmin:  superadmin@alloxentric.local  (clave: SUPERADMIN_PASSWORD en .env)'
Write-Host ''
Write-Host '  El primer arranque descarga el modelo de embeddings (~470 MB) y tarda ~30 s en quedar listo;'
Write-Host '  /health muestra "activo" cuando termino. Para apagar todo: .\detener.ps1'
Write-Host ''
if (-not $Simular -and -not $NoAbrirNavegador -and -not $SinFrontend) { Start-Process 'http://localhost:3000' }
