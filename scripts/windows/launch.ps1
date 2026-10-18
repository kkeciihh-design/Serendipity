param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
  [switch]$NoUI
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if (-not $NoUI) { Add-Type -AssemblyName System.Windows.Forms }
try {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "启动配置找不到：$ConfigPath`n请让维护者核对桌面入口与实际数据目录；不要删除数据或创建空白数据库。"
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $controller = Join-Path $config.projectRoot 'scripts\desktop-control.mjs'
  $progress = $null
  $controllerProcess = [Diagnostics.Process]::new()
  try {
      if (-not $NoUI -and $Action -eq 'start') {
        [System.Windows.Forms.Application]::EnableVisualStyles()
        $progress = [System.Windows.Forms.Form]::new()
        $progress.Text = 'Serendipity · 正在启动'
        $progress.ClientSize = [Drawing.Size]::new(460, 125)
        $progress.StartPosition = 'CenterScreen'
        $progress.FormBorderStyle = 'FixedDialog'
        $progress.ControlBox = $false
        $label = [System.Windows.Forms.Label]::new()
        $label.Text = if ($config.autoBuild -eq $false) { '正在启动旅行助手，请稍候。' } else { '正在检查更新；有改动时会自动构建，请稍候。' }
        $label.Location = [Drawing.Point]::new(22, 23)
        $label.Size = [Drawing.Size]::new(416, 46)
        $label.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
        $bar = [System.Windows.Forms.ProgressBar]::new()
        $bar.Location = [Drawing.Point]::new(22, 83)
        $bar.Size = [Drawing.Size]::new(416, 18)
        $bar.Style = 'Marquee'
        $progress.Controls.Add($label)
        $progress.Controls.Add($bar)
        $progress.Show()
        [System.Windows.Forms.Application]::DoEvents()
      }
      $controllerProcess.StartInfo.FileName = $config.nodePath
      $absoluteConfigPath = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
      $controllerProcess.StartInfo.Arguments = '"' + $controller + '" ' + $Action + ' --config "' + $absoluteConfigPath + '"'
      $controllerProcess.StartInfo.WorkingDirectory = $config.projectRoot
      $controllerProcess.StartInfo.UseShellExecute = $false
      $controllerProcess.StartInfo.CreateNoWindow = $true
      $controllerProcess.StartInfo.WindowStyle = 'Hidden'
      $controllerProcess.StartInfo.RedirectStandardOutput = $true
      $controllerProcess.StartInfo.RedirectStandardError = $true
      $controllerProcess.StartInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
      $controllerProcess.StartInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
      if (-not $controllerProcess.Start()) { throw '启动检查未能运行，请让维护者检查应用文件。' }
      # Keep controller output isolated from the caller's console, including in NoUI mode.
      # Drain both streams while keeping the modeless window responsive during a build.
      $outputTask = $controllerProcess.StandardOutput.ReadToEndAsync()
      $errorTask = $controllerProcess.StandardError.ReadToEndAsync()
      while (-not $controllerProcess.WaitForExit(100)) {
        if (-not $NoUI) { [System.Windows.Forms.Application]::DoEvents() }
      }
      $controllerProcess.WaitForExit()
      $resultText = $outputTask.GetAwaiter().GetResult()
      $null = $errorTask.GetAwaiter().GetResult()
      if ([string]::IsNullOrWhiteSpace($resultText)) { throw '启动检查未返回结果，请让维护者检查应用文件与运行日志；旅行数据保持原位置。' }
  } finally {
    if ($progress) { $progress.Close(); $progress.Dispose() }
    $controllerProcess.Dispose()
  }
  $result = ($resultText -join "`n") | ConvertFrom-Json
  if ($NoUI) { $result | ConvertTo-Json -Compress; exit $(if ($result.ok) { 0 } else { 1 }) }
  if (-not $result.ok) { throw $result.message }
  if ($Action -eq 'start' -and $result.status -eq 'ready') {
    if ($result.warning) {
      $warningMessage = "更新未完成，当前继续使用上一次可用版本。`n`n$($result.warning)`n`n稍后可再次点击「启动旅行助手」重试更新。"
      [System.Windows.Forms.MessageBox]::Show($warningMessage, 'Serendipity · 更新提示', 'OK', 'Warning') | Out-Null
    }
    Start-Process -FilePath $result.url
  } else {
    $labels = @{ ready = '运行正常'; stopped = '已停止'; starting = '正在启动'; stopping = '正在停止'; unresponsive = '后台进程未响应'; unhealthy = '网页或数据暂时不可用' }
    $message = $labels[$result.status]
    if ($result.message) { $message = $result.message }
    if ($result.url) { $message += "`n`n网页：$($result.url)" }
    if ($result.restoreActive) { $message += "`n恢复处理中，旅行写入暂时暂停。" }
    $message += "`n`n数据目录：$($result.dataDirectory)`n`n遇到问题时请把此状态告知维护者；请勿删除数据库。"
    [System.Windows.Forms.MessageBox]::Show($message, 'Serendipity · 运行状态', 'OK', 'Information') | Out-Null
  }
} catch {
  if ($NoUI) { @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress; exit 1 }
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Serendipity · 暂时无法完成', 'OK', 'Warning') | Out-Null
  exit 1
}
