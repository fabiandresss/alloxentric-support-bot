@echo off
rem Doble clic: apaga el proyecto (los datos se conservan).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0detener.ps1" %*
pause
