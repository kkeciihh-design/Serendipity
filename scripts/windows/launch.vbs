Option Explicit
Dim shell, fso, script, command, config, action
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 2 Then WScript.Quit 1
config = WScript.Arguments(0)
action = WScript.Arguments(1)
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch.ps1")
command = Quote(shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")) & " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(script) & " -ConfigPath " & Quote(config) & " -Action " & Quote(action)
shell.Run command, 0, False
Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
