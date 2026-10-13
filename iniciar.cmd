@echo off
rem Doble clic: levanta todo el proyecto (base de datos, backend y frontend).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1" %*
if errorlevel 1 pause
