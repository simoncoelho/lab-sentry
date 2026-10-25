# Run once from an Administrator PowerShell. Only local-subnet clients are allowed.
param([string]$Address = '192.168.0.80', [string]$Interface = 'Wi-Fi', [int]$Port = 5103)
$ErrorActionPreference = 'Stop'
$name = 'Lab Sentry read-only deck API (LAN)'
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress $Address -RemoteAddress LocalSubnet -InterfaceAlias $Interface -Profile Any
