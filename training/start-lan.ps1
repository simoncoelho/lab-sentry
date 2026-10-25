param([string]$Address, [int]$Port = 5103)
$ErrorActionPreference = 'Stop'
if (-not $Address) {
  $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
  $Address = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' } | Select-Object -First 1).IPAddress
}
if (-not $Address) { throw 'No LAN IPv4 address found. Supply -Address explicitly.' }
Write-Host "Read-only deck API: http://${Address}:$Port/api/v1/deck-state"
$python = Join-Path $PSScriptRoot '../.runtime/python/Scripts/python.exe'
if (-not (Test-Path $python)) { $python = Join-Path $PSScriptRoot '.venv/Scripts/python.exe' }
& $python "$PSScriptRoot/lan_server.py" --host $Address --port $Port
