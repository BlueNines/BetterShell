$ErrorActionPreference = 'Stop'
$application = Get-Process -Id ([int]$env:BETTERSHELL_NPP_ID)
if ($application.MainModule.FileName -ne $env:BETTERSHELL_NPP_EXE) { throw '编辑器进程已改变' }

# 只给 BetterShell 自己启动的窗口传递公开的 Notepad++ 文件打开消息。
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BetterShellNotepad {
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint rights, bool inherit, int id);
    [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr bytes, uint type, uint protection);
    [DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr bytes, out UIntPtr written);
    [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr bytes, uint type);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int show);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $application.Refresh()
    if ($application.MainWindowHandle -ne 0) { break }
    Start-Sleep -Milliseconds 100
}
$window = $application.MainWindowHandle
if ($window -eq 0) { throw '编辑器窗口尚未就绪' }
$files = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BETTERSHELL_NPP_FILES)) | ConvertFrom-Json
$processHandle = [BetterShellNotepad]::OpenProcess(0x28, $false, $application.Id)
if ($processHandle -eq [IntPtr]::Zero) { throw '无法访问对应编辑器窗口' }
try {
    foreach ($file in $files) {
        $bytes = [Text.Encoding]::Unicode.GetBytes($file + [char]0)
        $address = [BetterShellNotepad]::VirtualAllocEx($processHandle, [IntPtr]::Zero, [UIntPtr]::new([UInt64]$bytes.Length), 0x3000, 0x04)
        if ($address -eq [IntPtr]::Zero) { throw '无法传递编辑文件路径' }
        try {
            $written = [UIntPtr]::Zero
            if (-not [BetterShellNotepad]::WriteProcessMemory($processHandle, $address, $bytes, [UIntPtr]::new([UInt64]$bytes.Length), [ref]$written)) { throw '无法传递编辑文件路径' }
            $result = [UIntPtr]::Zero
            # NPPM_DOOPEN：Notepad++ 插件接口中公开的打开文件操作。
            if ([BetterShellNotepad]::SendMessageTimeout($window, 2101, [IntPtr]::Zero, $address, 2, 5000, [ref]$result) -eq [IntPtr]::Zero -or $result -eq [UIntPtr]::Zero) { throw 'Notepad++ 打开文件失败' }
        } finally { $null = [BetterShellNotepad]::VirtualFreeEx($processHandle, $address, [UIntPtr]::Zero, 0x8000) }
    }
    if ([BetterShellNotepad]::IsIconic($window)) { $null = [BetterShellNotepad]::ShowWindow($window, 9) }
    $null = [BetterShellNotepad]::SetForegroundWindow($window)
} finally { $null = [BetterShellNotepad]::CloseHandle($processHandle) }
