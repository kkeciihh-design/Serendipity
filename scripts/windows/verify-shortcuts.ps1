$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$configPath = Join-Path $env:LOCALAPPDATA 'Serendipity\runtime\launcher.json'
$shortcutDirectory = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Serendipity 日常使用'
$output = Join-Path $projectRoot 'test-data\verification-output\phase29'
$nodePath = (Get-Command node.exe).Source
$controller = Join-Path $projectRoot 'scripts\desktop-control.mjs'
function Read-Status { (& $nodePath $controller status --config $configPath) | ConvertFrom-Json }
function Wait-Status([string]$Expected) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $value = Read-Status
    if ($value.status -eq $Expected) { return $value }
    Start-Sleep -Milliseconds 500
  }
  throw "Shortcut did not reach $Expected"
}
function Open-Shortcut([string]$Name) { Start-Process -FilePath (Join-Path $shortcutDirectory ($Name + '.lnk')) }
function Check-Notice([int[]]$Existing) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $candidates = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -notin $Existing -and $_.CommandLine -like '*scripts\windows\launch.ps1*' -and $_.CommandLine -like ('*' + $configPath + '*') })
    foreach ($candidate in $candidates) {
      $notice = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
      if ($notice.MainWindowTitle -eq 'Serendipity · 运行状态') {
        # This is the test's completed one-shot notice, never the service process.
        $title = $notice.MainWindowTitle
        Stop-Process -Id $notice.Id
        return $title
      }
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'Expected native status notice was not observed'
}
$initial = Wait-Status 'ready'
Open-Shortcut '启动旅行助手'
Start-Sleep -Seconds 2
$repeat = Read-Status
if ($repeat.pid -ne $initial.pid) { throw 'Repeated shortcut started another instance' }
$beforeStop = @(Get-Process -Name powershell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
Open-Shortcut '停止旅行助手'
$stopped = Wait-Status 'stopped'
$stopNotice = Check-Notice $beforeStop
Open-Shortcut '启动旅行助手'
$restarted = Wait-Status 'ready'
if ($restarted.pid -eq $initial.pid) { throw 'Service did not restart' }
$beforeStatus = @(Get-Process -Name powershell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
Open-Shortcut '运行状态'
$statusNotice = Check-Notice $beforeStatus
$server = Get-Process -Id $restarted.pid
if ($server.MainWindowHandle -ne 0) { throw 'Service unexpectedly has a visible window' }
$browser = @(Get-Process -Name chrome,centbrowser,msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Serendipity*' } | Select-Object ProcessName,MainWindowTitle)
if ($browser.Count -lt 1) { throw 'Default browser did not open the application' }
$result = @{ checkedAt = [DateTime]::UtcNow.ToString('o'); method = 'Windows ShellExecute on installed .lnk files'; repeatedStartSamePid = $true; stopAndReopen = $true; stopNoticeTitle = $stopNotice; statusNoticeTitle = $statusNotice; serviceWindowHandle = 0; browser = $browser; final = $restarted }
[IO.File]::WriteAllText((Join-Path $output 'shortcuts-results.json'), ($result | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
$result | ConvertTo-Json -Depth 5
