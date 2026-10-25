$ErrorActionPreference = 'Stop'
$trainingRoot = $PSScriptRoot
& "$trainingRoot/.venv/Scripts/python.exe" "$trainingRoot/server.py"
