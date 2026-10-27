@echo off
setlocal
cd /d "%~dp0"
if not defined ISAAC_SIM_PATH set "ISAAC_SIM_PATH=C:\isaacsim"
if not exist "%ISAAC_SIM_PATH%\python.bat" (
  echo Set ISAAC_SIM_PATH to your Isaac Sim installation directory.
  exit /b 1
)
call "%ISAAC_SIM_PATH%\python.bat" simulation\isaac_server.py %*
