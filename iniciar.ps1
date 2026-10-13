<#
.SYNOPSIS
  Levanta TODO el proyecto en tu maquina (Windows): base de datos, backend y frontend.

.DESCRIPTION
  Es idempotente: puedes correrlo cuantas veces quieras; solo hace lo que falta.
    1. Revisa Docker (o no, con -SinDocker), Python y Node.
    2. Crea el .env con claves aleatorias si no existe (nunca pisa uno existente).
    3. Backend: crea el .venv e instala dependencias (solo si cambiaron).
    4. Base de datos: Postgres+pgvector y Redis con docker compose, o un Postgres embebido con -SinDocker.
    5. Migra y siembra datos de ejemplo (solo si la BD esta vacia).
    6. Frontend: npm install (solo si cambio).
    7. Abre cada servidor en su ventana y el navegador en http://localhost:3000

  Para apagar: .\detener.ps1   (o detener.cmd)

.PARAMETER SinDocker
  Usa un Postgres embebido (backend\dev_db.py, datos en backend\.pgdata) en vez de Docker. SOLO para desarrollo cuando no
  hay Docker. Ojo: ese pgvector se cae al calcular distancias en CPUs sin AVX-512; en este modo se usa RAG_SEARCH=python
  (busqueda exacta en el backend) y se elimina el indice HNSW de ESA base. Con Docker nada de esto es necesario.
.PARAMETER Reset
  Borra la base de datos y la vuelve a sembrar desde cero.
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
  .\iniciar.ps1 -SinDocker
.EXAMPLE
  .\iniciar.ps1 -Reset
#>
[CmdletBinding()]
param(
    [switch]$SinDocker,
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

function Silencioso([scriptblock]$bloque) {
    # Ejecuta un programa nativo sin mostrar su salida y devuelve su codigo. En PowerShell 5.1, con ErrorActionPreference=Stop,
    # redirigir el stderr de un programa nativo lanza una excepcion: por eso se baja a Continue solo aqui.
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $bloque *> $null } finally { $ErrorActionPreference = $anterior }
    return $LASTEXITCODE
}

function Proceso-Vivo([string]$archivoPid) {
    $f = Join-Path $Run $archivoPid
    if (-not (Test-Path $f)) { return $false }
    $id = (Get-Content $f | Select-Object -First 1)
    return [bool](($id -match '^\d+$') -and (Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue))
}

# ---------------------------------------------------------------- 1. requisitos
Paso 'Revisando requisitos'
if ($Simular) {
    Info '(simulacion) se omite la revision de Docker/Python/Node'
} elseif (-not $SoloConfigurar) {
    $requisitos = @(
        @('python', 'Python 3.11 o superior (https://www.python.org/downloads/), marcando "Add to PATH"'),
        @('node',   'Node.js 20 o superior (https://nodejs.org/)'))
    if (-not $SinDocker) {
        $requisitos = @(, @('docker', 'Docker Desktop (https://www.docker.com/products/docker-desktop), abrelo y espera a que diga Running. Sin Docker puedes usar: .\iniciar.ps1 -SinDocker')) + $requisitos
    }
    foreach ($c in $requisitos) {
        if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { Fallo "Falta '$($c[0])'. Instala $($c[1])" }
    }
    $v = (& python --version) 2>&1
    if ($v -notmatch 'Python 3\.(\d+)' -or [int]$Matches[1] -lt 11) { Fallo "Se necesita Python 3.11 o superior (tienes: $v)" }
    Ok "$v | Node $(& node --version)"
    if ($SinDocker) {
        Aviso 'Modo -SinDocker: Postgres embebido (solo desarrollo). Con Docker la busqueda usa el indice HNSW de pgvector.'
    } else {
        Ok "$((& docker --version))"
        if ((Silencioso { & docker info }) -ne 0) { Fallo 'Docker esta instalado pero no esta corriendo. Abre Docker Desktop, espera a que diga "Running" y reintenta.' }
        Ok 'Docker Desktop esta corriendo'
    }
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

# ---------------------------------------------------------------- 3. backend: entorno y dependencias
Paso 'Backend: entorno de Python'
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
} finally { Pop-Location }

# ---------------------------------------------------------------- 4. base de datos
if ($SinDocker) {
    Paso 'Base de datos (Postgres embebido, SIN Docker)'
    if ($Reset) {
        Aviso 'Reset: se borra backend\.pgdata y se vuelve a sembrar.'
        Hacer 'detener el Postgres embebido y borrar .pgdata' {
            & (Join-Path $Raiz 'detener.ps1') -SoloProcesos | Out-Null
            Remove-Item -Recurse -Force (Join-Path $Back '.pgdata') -ErrorAction SilentlyContinue
            Remove-Item -Force (Join-Path $Run 'db.url') -ErrorAction SilentlyContinue
        }
    }
    Hacer 'instalar pixeltable-pgserver si falta' {
        if ((Silencioso { & $Py -c 'import pixeltable_pgserver' }) -ne 0) {
            Info 'instalando pixeltable-pgserver (Postgres embebido)...'
            & $Py -m pip install --disable-pip-version-check pixeltable-pgserver
            Verificar-Salida 'pip install pixeltable-pgserver (si falla por rutas largas, activa Long Paths de Windows o usa Docker)'
        }
    }
    Hacer 'iniciar backend\dev_db.py y leer su DATABASE_URL' {
        New-Item -ItemType Directory -Force -Path $Run | Out-Null
        $urlFile = Join-Path $Run 'db.url'
        if (-not ((Proceso-Vivo 'db.pid') -and (Test-Path $urlFile))) {
            Remove-Item $urlFile -Force -ErrorAction SilentlyContinue
            $url = $null
            # Tras un cierre abrupto Postgres hace recuperacion y puede tardar mas que el timeout de pg_ctl: dev_db.py falla
            # aunque el servidor termine levantando. Un nuevo intento se engancha al servidor ya arriba.
            for ($intento = 1; $intento -le 3 -and -not $url; $intento++) {
                if ($intento -gt 1) { Info "reintento $intento de 3 (Postgres se estaba recuperando)..."; Start-Sleep -Seconds 5 }
                $salida = Join-Path $Run 'db.out.log'
                Remove-Item $salida -Force -ErrorAction SilentlyContinue
                $p = Start-Process $Py -ArgumentList @('-u', 'dev_db.py') -WorkingDirectory $Back -PassThru -WindowStyle Hidden `
                    -RedirectStandardOutput $salida -RedirectStandardError (Join-Path $Run 'db.err.log')
                Set-Content -Path (Join-Path $Run 'db.pid') -Value $p.Id
                for ($i = 0; $i -lt 90 -and -not $url -and -not $p.HasExited; $i++) {
                    Start-Sleep -Seconds 1
                    if (Test-Path $salida) {
                        $m = Select-String -Path $salida -Pattern '^DATABASE_URL=(.+)$' -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($m) { $url = $m.Matches[0].Groups[1].Value.Trim() }
                    }
                }
            }
            if (-not $url) { Fallo "El Postgres embebido no arranco tras 3 intentos. Mira $(Join-Path $Run 'db.err.log')" }
            Set-Content -Path $urlFile -Value $url
        }
        $script:UrlEmbebida = (Get-Content $urlFile | Select-Object -First 1).Trim()
        # las variables de entorno mandan sobre .env (python-dotenv no las pisa) y las heredan la API y las migraciones
        $env:DATABASE_URL = $script:UrlEmbebida
        $env:RAG_SEARCH   = 'python'
        Ok 'Postgres embebido listo'
        Info "DATABASE_URL (solo esta sesion): $($env:DATABASE_URL -replace ':[^:@/]*@', ':****@')"
    }
} else {
    Paso 'Base de datos (Postgres + pgvector, Redis)'
    Push-Location $Raiz
    try {
        if ($Reset) {
            Aviso 'Reset: se borra la base de datos y se vuelve a sembrar.'
            Hacer 'docker compose down -v' { & docker compose down -v; Verificar-Salida 'docker compose down' }
        }
        Hacer 'elegir puerto libre para la BD' {
            # un PostgreSQL ya instalado en Windows suele ocupar 5432: se usa otro y se deja en .env
            $puerto = 5432
            $m = Select-String -Path $EnvRaiz -Pattern '^DB_PORT=(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) { $puerto = [int]$m.Matches[0].Groups[1].Value }
            $nuestro = ((& docker ps --filter 'name=chatbot-soporte-db' --format '{{.Names}}') -match 'chatbot-soporte-db')
            if ((Puerto-Ocupado $puerto) -and -not $nuestro) {
                $nuevo = (5433..5440 | Where-Object { -not (Puerto-Ocupado $_) } | Select-Object -First 1)
                if (-not $nuevo) { Fallo "El puerto $puerto esta ocupado y no encontre otro libre (5433-5440). Libera uno o define DB_PORT en .env." }
                Aviso "El puerto $puerto esta ocupado (otro PostgreSQL?). Se usara el $nuevo para la BD del proyecto."
                $txt = Get-Content $EnvRaiz
                $txt = $txt | Where-Object { $_ -notmatch '^#?\s*DB_PORT=' }
                $txt = $txt | ForEach-Object { if ($_ -match '^DATABASE_URL=') { $_ -replace '@127\.0\.0\.1:\d+/', "@127.0.0.1:$nuevo/" } else { $_ } }
                $txt += "DB_PORT=$nuevo"
                [IO.File]::WriteAllLines($EnvRaiz, [string[]]$txt, (New-Object Text.UTF8Encoding($false)))
                Ok "DB_PORT=$nuevo y DATABASE_URL actualizados en .env"
            }
        }
        Hacer 'docker compose up -d' { & docker compose up -d; Verificar-Salida 'docker compose up' }
        Hacer 'esperar a Postgres' {
            $listo = $false
            for ($i = 0; $i -lt 60; $i++) {
                if ((Silencioso { & docker compose exec -T db pg_isready -U chatbot -d chatbot_soporte }) -eq 0) { $listo = $true; break }
                Start-Sleep -Seconds 1
            }
            if (-not $listo) { Fallo 'Postgres no respondio en 60 s. Mira: docker compose logs db' }
            Ok 'Postgres responde'
        }
    } finally { Pop-Location }
}

# ---------------------------------------------------------------- 5. esquema y datos
Paso 'Backend: esquema y datos'
Push-Location $Back
try {
    Hacer 'alembic upgrade head' { & $Py -m alembic upgrade head; Verificar-Salida 'alembic upgrade head'; Ok 'esquema de BD al dia' }

    if ($SinDocker) {
        Hacer 'quitar el indice HNSW de la BD embebida' {
            # ese pgvector se cae al calcular distancias (CPUs sin AVX-512): sin el indice, las inserciones no lo tumban
            & $Py -c "import os, sqlalchemy as sa; c = sa.create_engine(os.environ['DATABASE_URL']).connect(); c.execute(sa.text('DROP INDEX IF EXISTS ix_fragmentos_embedding_hnsw')); c.commit()"
            Verificar-Salida 'quitar el indice HNSW'
            Info 'indice HNSW omitido en esta BD embebida (busqueda exacta en el backend: RAG_SEARCH=python)'
        }
    }

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

# ---------------------------------------------------------------- 6. frontend
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

# ---------------------------------------------------------------- 7. arranque
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
    Info 'esperando a la API (la primera vez importa torch y el modelo: puede tardar 1-3 minutos)...'
    $arriba = $false
    for ($i = 0; $i -lt 240; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8000/health' -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $arriba = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if ($arriba) { Ok 'API arriba: http://localhost:8000/docs' } else { Aviso 'La API no respondio en 4 minutos: revisa su ventana.' }
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
