# Windows: release EcoQoS (power throttling) from battle-ai-sim node processes so long measurements use all cores.
# Symptom: rank-ladder/rank-sweep runs at ~25% total CPU with only the 4 E-cores busy (hybrid CPU, e.g. i7-13620H).
# Usage (separate terminal, while the measurement runs): powershell -NoProfile -ExecutionPolicy Bypass -File scripts/win-unthrottle.ps1
# Keep this file ASCII-only: Windows PowerShell 5.1 misreads BOM-less UTF-8.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Throttle {
  [StructLayout(LayoutKind.Sequential)] public struct PPT { public uint Version; public uint ControlMask; public uint StateMask; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetProcessInformation(IntPtr h, int cls, ref PPT info, int size);
  public static bool Off(int pid) {
    IntPtr h = OpenProcess(0x0200 | 0x1000, false, pid);
    if (h == IntPtr.Zero) return false;
    PPT p = new PPT { Version = 1, ControlMask = 1, StateMask = 0 };
    bool ok = SetProcessInformation(h, 4, ref p, Marshal.SizeOf(typeof(PPT)));
    CloseHandle(h);
    return ok;
  }
}
'@
$done = @{}; $idle = 0
while ($idle -lt 20) {
  $ids = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'battle-ai-sim' } | ForEach-Object { $_.ProcessId })
  foreach ($id in $ids) { if (-not $done.ContainsKey($id)) { if ([Throttle]::Off($id)) { $done[$id] = $true } } }
  if ($ids.Count -eq 0) { $idle++ } else { $idle = 0 }
  Start-Sleep -Seconds 3
}
"done: released $($done.Count) processes"
