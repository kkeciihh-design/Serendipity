$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = Join-Path $projectRoot 'test-data\phase29-permissions'
$output = Join-Path $projectRoot 'test-data\verification-output\phase29'
New-Item -ItemType Directory -Force -Path (Join-Path $target 'runtime'), $output | Out-Null
$configPath = Join-Path $output 'permissions.json'
$config = @{ version = 1; projectRoot = $projectRoot; dataDirectory = $target; nodePath = (Get-Command node.exe).Source; buildDirectory = '.next-phase29-release'; preferredPort = 3142 }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$originalAcl = Get-Acl -LiteralPath $target
$deniedAcl = Get-Acl -LiteralPath $target
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'Write', 'ContainerInherit,ObjectInherit', 'None', 'Deny')
$deniedAcl.AddAccessRule($rule)
try {
  Set-Acl -LiteralPath $target -AclObject $deniedAcl
  $rejected = (& $config.nodePath (Join-Path $projectRoot 'scripts\desktop-control.mjs') start --config $configPath) | ConvertFrom-Json
  if ($rejected.ok -or $rejected.message -notmatch '无法读写旅行数据目录') { throw ('Expected clear permission failure: ' + ($rejected | ConvertTo-Json)) }
} finally { Set-Acl -LiteralPath $target -AclObject $originalAcl }
$recovered = (& $config.nodePath (Join-Path $projectRoot 'scripts\desktop-control.mjs') start --config $configPath) | ConvertFrom-Json
try { if (-not $recovered.ok) { throw ('Restart after permission repair failed: ' + ($recovered | ConvertTo-Json)) } }
finally { $stopped = (& $config.nodePath (Join-Path $projectRoot 'scripts\desktop-control.mjs') stop --config $configPath) | ConvertFrom-Json }
if (-not $stopped.ok) { throw 'Test instance did not stop' }
$result = @{ checkedAt = [DateTime]::UtcNow.ToString('o'); realWindowsDenyWrite = $true; userMessage = $rejected.message; recoveredSameDirectory = $recovered.dataDirectory -eq $target; stopped = $stopped.ok }
[IO.File]::WriteAllText((Join-Path $output 'permissions-results.json'), ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$result | ConvertTo-Json
