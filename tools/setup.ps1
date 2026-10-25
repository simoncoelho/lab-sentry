$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = (Get-Location).Path
$busy = Get-NetTCPConnection -State Listen -LocalPort 5100,5101,5102,5173 -ErrorAction SilentlyContinue
if ($busy) { throw 'Close Lab Sentry before running Setup.cmd. Its running services lock files that setup needs to update.' }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
function Require-Tool($command, $package) {
    if (Get-Command $command -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Install $package, then rerun Setup.cmd. Windows App Installer provides winget." }
    Write-Host "Installing $package..."
    & winget install --id $package --exact --source winget
    if ($LASTEXITCODE -ne 0) { throw "Could not install $package. Install it manually and rerun Setup.cmd." }
    Refresh-Path
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Close this window and rerun Setup.cmd to finish setting up $package." }
}
Require-Tool node OpenJS.NodeJS.LTS
Require-Tool dotnet Microsoft.DotNet.SDK.10
Require-Tool uv astral-sh.uv
$nodeVersion = [version](& node -p 'process.versions.node')
if ($nodeVersion -lt [version]'22.12.0') { throw 'Node.js 22.12 or newer is required. Install Node.js LTS, then rerun Setup.cmd.' }
if (-not ((& dotnet --list-sdks) -match '^10\.')) { throw 'Install the .NET 10 SDK, then rerun Setup.cmd.' }
New-Item -ItemType Directory -Force .runtime,.dependencies | Out-Null
# Pin camera code so setup does not silently change when its main branch moves.
$revision = '517dffa4fdd822fa3f0619c519b4224d1e4e53fb'
$camera = Join-Path $root ".dependencies/obsbot-control-$revision"
if (-not (Test-Path "$camera/src/Obsbot.Control/Obsbot.Control.csproj")) {
    Write-Host 'Downloading camera support...'
    Invoke-WebRequest "https://codeload.github.com/simoncoelho/obsbot-control/zip/$revision" -OutFile .runtime/camera.zip -UseBasicParsing
    Expand-Archive -LiteralPath .runtime/camera.zip -DestinationPath .dependencies -Force
}
Write-Host 'Installing Python and CPU inference dependencies (first setup may take several minutes)...'
if (-not (Test-Path .runtime/python/Scripts/python.exe)) {
    & uv venv --python 3.13 .runtime/python
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
& uv pip install --python .runtime/python/Scripts/python.exe torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'CPU PyTorch installation failed.' }
& uv pip install --python .runtime/python/Scripts/python.exe -r training/requirements-cpu.lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed.' }
& npm.cmd ci --prefix device-designer
if ($LASTEXITCODE -ne 0) { throw 'Web dependencies failed.' }
& npm.cmd run build --prefix device-designer
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
& dotnet publish camera-bridge/CameraBridge.csproj -c Release -o .runtime/control "-p:ObsbotRoot=$camera"
if ($LASTEXITCODE -ne 0) { throw 'Camera controls build failed.' }
& dotnet publish "$camera/src/Obsbot.Control.Lab/Obsbot.Control.Lab.csproj" -c Release -o .runtime/video
if ($LASTEXITCODE -ne 0) { throw 'Camera video build failed.' }
& .runtime/python/Scripts/python.exe tools/doctor.py
if ($LASTEXITCODE -ne 0) { throw 'Installation check failed.' }
