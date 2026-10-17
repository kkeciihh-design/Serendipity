param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
  [switch]$NoUI
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
try {
  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $controller = Join-Path $config.projectRoot 'scripts\desktop-control.mjs'
  $resultText = & $config.nodePath $controller $Action --config $ConfigPath
  $result = ($resultText -join "`n") | ConvertFrom-Json
  if ($NoUI) { $result | ConvertTo-Json -Compress; exit $(if ($result.ok) { 0 } else { 1 }) }
  if (-not $result.ok) { throw $result.message }
  if ($Action -eq 'start' -and $result.status -eq 'ready') {
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
