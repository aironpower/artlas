@echo off
REM Reanuda la ingesta de Artlas. Doble clic y se puede cerrar VSCode.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reanudar-ingesta.ps1"
pause
