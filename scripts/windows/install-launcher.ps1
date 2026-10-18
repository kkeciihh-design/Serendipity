param(
  [Parameter(Mandatory = $true)][string]$BuildDirectory,
  [string]$DataDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'SerendipityData'),
  [int]$PreferredPort = 3003,
  [string]$ShortcutDirectory = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Serendipity 日常使用'),
  [switch]$PinnedBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'resolve-physical-path.ps1')
$projectRoot = Resolve-PhysicalPath (Join-Path $PSScriptRoot '..\..')
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
$nodePath = Resolve-PhysicalPath (Get-Command node.exe -ErrorAction Stop).Source
if ($BuildDirectory -notmatch '^\.next-[a-z0-9-]+$' -or -not (Test-Path -LiteralPath (Join-Path $projectRoot "$BuildDirectory\BUILD_ID"))) { throw '请先完成并验证所选生产构建。' }
# A new default must never silently replace an existing user's database.
if (-not $PSBoundParameters.ContainsKey('DataDirectory') -and -not (Test-Path -LiteralPath (Join-Path $dataRoot 'data\serendipity.db'))) {
  $legacyRoot = Join-Path $env:LOCALAPPDATA 'Serendipity'
  if (Test-Path -LiteralPath $legacyRoot) { throw '发现旧数据目录。请先备份并迁移原数据，或用 -DataDirectory 明确指定已核验的数据目录；未创建空白数据库。' }
}
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$dataRoot = Resolve-PhysicalPath $dataRoot
$runtimeDirectory = Join-Path $dataRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$configPath = Join-Path $runtimeDirectory 'launcher.json'
# Updating an installed release is explicit; never redirect a running instance.
$statePath = Join-Path $runtimeDirectory 'service.json'
if (Test-Path -LiteralPath $statePath) { throw '请先停止当前桌面实例，再安装或更新入口。' }
$config = @{ version = 1; projectRoot = $projectRoot; dataDirectory = $dataRoot; nodePath = $nodePath; buildDirectory = $BuildDirectory; autoBuild = -not $PinnedBuild; preferredPort = $PreferredPort; databaseRequired = (Test-Path -LiteralPath (Join-Path $dataRoot 'data\serendipity.db')) }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
New-Item -ItemType Directory -Path $ShortcutDirectory -Force | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($entry in @(@('启动旅行助手', 'start'), @('停止旅行助手', 'stop'), @('运行状态', 'status'))) {
  $shortcut = $shell.CreateShortcut((Join-Path $ShortcutDirectory ($entry[0] + '.lnk')))
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $shortcut.Arguments = '"' + (Join-Path $projectRoot 'scripts\windows\launch.vbs') + '" "' + $configPath + '" "' + $entry[1] + '"'
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Serendipity 本机旅行助手：' + $entry[0]
  $shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + $(if ($entry[1] -eq 'stop') { ',27' } elseif ($entry[1] -eq 'status') { ',23' } else { ',14' })
  $shortcut.Save()
}
$startupGuide = if ($PinnedBuild) {
  '本入口固定使用安装时所选版本。重复启动会复用同一个应用；更新版本需由维护者重新配置入口。'
} else {
  '每次启动会自动检查源码。首次启用或源码有改动时，会先构建最新版，可能需要一两分钟；没有改动时会复用已完成的构建。运行中再次点击启动也会应用最新修改，请先保存编辑内容。更新构建失败时会提示原因并继续使用上一次可用版本。'
}
$guide = @"
Serendipity 日常使用

1. 双击“启动旅行助手”，等待启动窗口完成检查，网页会自动打开。$startupGuide
2. 先保存编辑内容，再双击“停止旅行助手”。只关闭浏览器不会停止后台应用。
3. 重启电脑后重新双击启动即可，不需要命令，不会自动开机启动。
4. 若打不开，请双击“运行状态”。端口冲突会自动换用空闲地址，始终从启动入口打开正确网页。

数据目录：$dataRoot
应用目录：$projectRoot
请保留这两个目录。不要移动应用目录或删除旅行数据库。更换电脑前，在网页“个人设置 → 数据管理”下载 JSON 旅行备份。
新电脑恢复旅行后，通过设置页重新配置服务凭据。两个实例没有自动同步。

本次交付为本机运行，只能由这台电脑访问。电脑关闭或休眠时不能访问。
手机出行请提前保存文字、长图、PDF 等离线资料；离线内容不实时更新，也不能在线 AI 重规划。
没有个人外网地址。手机一页版 HTML 的 Android/iOS 真机打开方式仍待核验。

遇到权限、文件缺失或启动失败，入口会说明原因。请把运行状态告知维护者，不要删除数据来修复。
"@
[IO.File]::WriteAllText((Join-Path $ShortcutDirectory '使用说明.txt'), $guide, [Text.UTF8Encoding]::new($true))
[PSCustomObject]@{ configPath = $configPath; shortcutDirectory = [IO.Path]::GetFullPath($ShortcutDirectory); nodePath = $nodePath } | ConvertTo-Json
