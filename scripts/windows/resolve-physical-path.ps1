# Resolve the path seen by Windows, including packaged-app filesystem redirection.
# Resolve-Path / GetFullPath alone preserve a logical path Explorer may not see.
if (-not ('Serendipity.NativePaths' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
namespace Serendipity {
  public static class NativePaths {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    public static string Resolve(string path) {
      using (var handle = CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (length >= buffer.Capacity) throw new System.IO.PathTooLongException();
        string result = buffer.ToString();
        if (result.StartsWith(@"\\?\UNC\")) return @"\\" + result.Substring(8);
        return result.StartsWith(@"\\?\") ? result.Substring(4) : result;
      }
    }
  }
}
"@
}
function Resolve-PhysicalPath([string]$Path) {
  [Serendipity.NativePaths]::Resolve([IO.Path]::GetFullPath($Path))
}
