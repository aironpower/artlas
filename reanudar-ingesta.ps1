# ============================================================================
# Artlas - reanudar la ingesta sin necesidad de la sesion del asistente
#
# Se lanza haciendo doble clic en reanudar-ingesta.cmd, y hace tres cosas en
# este orden, que es el unico que funciona:
#
#   1. Espera a que no quede ninguna ingesta viva. Aplicar migraciones o tocar
#      el catalogo con una ingesta escribiendo ya tumbo tres museos.
#   2. Aplica las migraciones pendientes. Hace falta: la ingesta ahora guarda
#      el numero de inventario y la columna la crea la migracion 0017. Sin
#      ella fallaria CADA escritura.
#   3. Lanza el barrido completo, que se salta solo los museos ya hechos.
#
# Todo queda registrado en ingesta.log, en la raiz del repo.
# ============================================================================

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$log  = Join-Path $raiz 'ingesta.log'

function Apunta($texto) {
    $linea = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
    Write-Host $linea
    Add-Content -Path $log -Value $linea -Encoding utf8
}

# Node 22: el del PATH de Windows es el 16 y no sirve.
$env:PATH = "$env:APPDATA\nvm\v22.12.0;$env:PATH"

Set-Location (Join-Path $raiz 'packages\ingest')

Apunta "=== reanudar-ingesta ==="

# --- 1. Esperar a que no quede ninguna ingesta -----------------------------
function IngestaViva {
    $procesos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match 'cli\.ts' }
    return ($null -ne $procesos -and $procesos.Count -gt 0)
}

$esperas = 0
while (IngestaViva) {
    if ($esperas -eq 0) { Apunta "hay una ingesta corriendo; esperando a que termine..." }
    Start-Sleep -Seconds 20
    $esperas++
    if ($esperas -gt 180) {   # una hora
        Apunta "sigue viva tras una hora. Se sale para no pisarla."
        exit 1
    }
}
Apunta "no hay ninguna ingesta viva"

# --- 2. Migraciones pendientes ---------------------------------------------
Apunta "ensayando migraciones pendientes..."
npm run migrate -- --dry-run 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
    Apunta "el ensayo falla: NO se aplica nada y no se lanza la ingesta."
    exit 1
}

Apunta "aplicando migraciones..."
npm run migrate 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { Apunta "fallo al aplicar migraciones. Se sale."; exit 1 }

# --- 3. El barrido ----------------------------------------------------------
# Se salta solo los museos con checkpoint, asi que retoma donde se quedo:
# Met, Viena, Belgica y Filadelfia.
Apunta "lanzando el barrido completo (los museos ya hechos se saltan solos)"
npm run start -- --all --everything 2>&1 | Tee-Object -FilePath $log -Append

Apunta "=== terminado (codigo $LASTEXITCODE) ==="
