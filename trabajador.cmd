@echo off
rem ===========================================================================
rem  Artlas - el trabajador
rem
rem  Se queda escuchando encargos hechos desde /es/admin/ingesta y los ejecuta
rem  en esta maquina. Doble clic y dejar la ventana abierta.
rem
rem  Deliberadamente simple, y por un motivo: `reanudar-ingesta.cmd` (borrado el
rem  2 de septiembre) intento ser listo con PowerShell, se murio dos veces en
rem  silencio y nunca llego a lanzar un barrido. Aqui no hay PowerShell, ni
rem  Tee-Object, ni trampas de UTF-16: chcp para que los acentos salgan bien,
rem  el PATH del Node bueno, y a correr.
rem
rem  Si el trabajador se cae, el bucle lo vuelve a levantar a los diez segundos.
rem  Que no se caiga es cosa suya; que vuelva, de aqui.
rem ===========================================================================

chcp 65001 >nul
set "PATH=%APPDATA%\nvm\v22.12.0;%PATH%"
cd /d "%~dp0packages\ingest"

echo Artlas - trabajador. Cierra esta ventana para pararlo.
echo.

:bucle
call npm run worker
echo.
echo [%date% %time%] el trabajador se ha parado; se reintenta en 10 s
timeout /t 10 /nobreak >nul
goto bucle
