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

# Nada puede morirse en silencio: si salta algo no previsto, queda escrito.
trap {
    Apunta "ERROR NO PREVISTO: $_"
    Apunta "=== abortado ==="
    exit 1
}

# ---------------------------------------------------------------------------
# DOS TRAMPAS DE POWERSHELL 5.1 QUE TUMBARON ESTE SCRIPT EN SILENCIO
#
# Estuvo roto desde el principio y nadie lo supo: moría siempre en el mismo
# punto, el ensayo de migraciones, sin escribir una sola linea de error.
#
# 1. `npm ... 2>&1` dentro de PowerShell 5.1 envuelve CADA linea de stderr en
#    un ErrorRecord. Con $ErrorActionPreference = 'Stop' eso es un error
#    terminante, aunque el comando devuelva 0. `migrate` imprime un aviso
#    inofensivo sobre el certificado y con eso bastaba para matar el script.
#    Solucion: que la redireccion la haga cmd, no PowerShell.
#
# 2. `Tee-Object` en 5.1 escribe UTF-16 y no acepta -Encoding. El log salia
#    con un byte nulo entre letra y letra, ilegible para grep y para tail.
#    Solucion: escribir con Add-Content -Encoding utf8.
#
# `Registra` arregla las dos: recibe la salida ya fusionada por cmd, la enseña
# por pantalla y la anade al log en UTF-8.
# ---------------------------------------------------------------------------
filter Registra {
    Write-Host $_
    Add-Content -Path $log -Value $_ -Encoding utf8
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
cmd /c "chcp 65001 >nul & npm run migrate -- --dry-run 2>&1" | Registra
if ($LASTEXITCODE -ne 0) {
    Apunta "el ensayo falla (codigo $LASTEXITCODE): NO se aplica nada y no se lanza la ingesta."
    exit 1
}

Apunta "aplicando migraciones..."
cmd /c "chcp 65001 >nul & npm run migrate 2>&1" | Registra
if ($LASTEXITCODE -ne 0) { Apunta "fallo al aplicar migraciones (codigo $LASTEXITCODE). Se sale."; exit 1 }

# --- 3. El barrido ----------------------------------------------------------
# Se salta solo los museos con checkpoint, asi que retoma donde se quedo:
# Met, Viena, Belgica y Filadelfia.
Apunta "lanzando el barrido completo (los museos ya hechos se saltan solos)"
cmd /c "chcp 65001 >nul & npm run start -- --all --everything 2>&1" | Registra
$codigo = $LASTEXITCODE

if ($codigo -eq 0) { Apunta "=== terminado bien ==="       }
else               { Apunta "=== TERMINADO MAL (codigo $codigo) ===" }
exit $codigo
