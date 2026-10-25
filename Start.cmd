@echo off
cd /d "%~dp0"
if not exist ".runtime\python\Scripts\python.exe" (echo Run Setup.cmd first. & pause & exit /b 1)
".runtime\python\Scripts\python.exe" tools\launch.py
if errorlevel 1 pause
