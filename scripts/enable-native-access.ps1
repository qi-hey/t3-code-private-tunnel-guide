param(
    [Parameter(Mandatory=$true)][string]$AppExecutable,
    [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port,
    [string]$T3Home = (Join-Path $env:USERPROFILE '.t3'),
    [switch]$Apply,
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
if ($Start -and -not $Apply) { throw '-Start requires -Apply.' }
$executable = (Resolve-Path -LiteralPath $AppExecutable).Path
$settingsPath = Join-Path $T3Home 'userdata\desktop-settings.json'
if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    throw 'Desktop settings were not found. Verify T3Home and initialize the desktop app first.'
}
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
if ($settings -isnot [pscustomobject]) { throw 'Desktop settings must be a JSON object.' }
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $executable })
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$plan = [ordered]@{
    mode = 'network-accessible'
    port = $Port
    nativePortVariable = 'T3CODE_PORT'
    runningAppProcesses = $running.Count
    portOccupied = $listeners.Count -gt 0
    applyRequested = [bool]$Apply
    createsBackgroundService = $false
}
if (-not $Apply) { $plan | ConvertTo-Json; return }
if ($running.Count) { throw 'Close T3 normally before applying; this script does not terminate it.' }
if ($listeners.Count) { throw 'The requested port is occupied. Resolve ownership before applying.' }

$backupRoot = Join-Path $T3Home 'maintenance\native-access-backups'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backup = Join-Path $backupRoot ('desktop-settings-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
Copy-Item -LiteralPath $settingsPath -Destination $backup -ErrorAction Stop
$previousPort = [Environment]::GetEnvironmentVariable('T3CODE_PORT', 'User')
$backupState = @{ previousUserPort = $previousPort; settingsBackup = [IO.Path]::GetFileName($backup) }
[IO.File]::WriteAllText($backup + '.state.json', ($backupState | ConvertTo-Json),
    [Text.UTF8Encoding]::new($false))
$settings | Add-Member -NotePropertyName serverExposureMode -NotePropertyValue 'network-accessible' -Force
$temporary = $settingsPath + '.native-access.tmp'
try {
    [IO.File]::WriteAllText($temporary, ($settings | ConvertTo-Json -Depth 50),
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $settingsPath -Force
    [Environment]::SetEnvironmentVariable('T3CODE_PORT', [string]$Port, 'User')
} catch {
    Copy-Item -LiteralPath $backup -Destination $settingsPath -Force
    [Environment]::SetEnvironmentVariable('T3CODE_PORT', $previousPort, 'User')
    throw
}
$env:T3CODE_PORT = [string]$Port
$env:T3CODE_HOME = $T3Home
$plan['configurationSaved'] = $true
$plan['backupCreated'] = $true
if ($Start) {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $client = Start-Process -FilePath $executable -WorkingDirectory (Split-Path $executable) `
        -WindowStyle Normal -PassThru
    $plan['launchedClientProcessId'] = $client.Id
}
$plan | ConvertTo-Json
