@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup.ps1"
if errorlevel 1 (echo Setup failed. See the message above. & pause & exit /b 1)
echo Setup complete. Double-click Start.cmd to open Lab Sentry.
pause
