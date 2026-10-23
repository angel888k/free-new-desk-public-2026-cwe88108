#Requires -Version 7.0
[CmdletBinding()]
param([string]$AppPath = '', [string]$ReleaseDir = '', [string]$MpvDllPath = '', [string]$EvidencePath = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$packaged = [bool]($AppPath -or $ReleaseDir)
if (-not $AppPath) { $AppPath = if ($ReleaseDir) { Join-Path $ReleaseDir 'win-unpacked/Free New Desk.exe' } else { Join-Path $root 'node_modules/electron/dist/electron.exe' } }
if (-not $MpvDllPath) { $MpvDllPath = if ($packaged) { Join-Path (Split-Path $AppPath) 'resources/native/player-host/libmpv-2.dll' } else { Join-Path $root 'third_party/mpv/win-x64/libmpv-2.dll' } }
if (-not $EvidencePath) { $EvidencePath = Join-Path $root 'dist/runtime-inventory.json' }
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path
$MpvDllPath = (Resolve-Path -LiteralPath $MpvDllPath).Path

function Invoke-HiddenInventoryCommand([string]$File, [string[]]$Arguments, [switch]$ElectronNode) {
  $start = [Diagnostics.ProcessStartInfo]::new($File)
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
  # Normalize the inherited Windows PATH aliases for child runtimes only.
  $childPath = $env:Path
  foreach ($key in @($start.Environment.Keys | Where-Object { $_ -ieq 'Path' })) { [void]$start.Environment.Remove($key) }
  $start.Environment['Path'] = $childPath
  $start.Environment.Remove('NODE_OPTIONS') | Out-Null
  if ($ElectronNode) { $start.Environment['ELECTRON_RUN_AS_NODE'] = '1' }
  $child = [Diagnostics.Process]::Start($start)
  try {
    $stdout = $child.StandardOutput.ReadToEndAsync()
    $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(20000)) { $child.Kill($true); throw "Runtime inventory command timed out: $File" }
    $output = $stdout.GetAwaiter().GetResult()
    $errorText = $stderr.GetAwaiter().GetResult()
    if ($child.ExitCode -ne 0) { throw "Runtime inventory command failed ($($child.ExitCode)): $File $errorText" }
    return @{ stdout=$output.Trim(); stderr=$errorText.Trim() }
  } finally { $child.Dispose() }
}

if (-not ('NativeMpvInventory' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class NativeMpvInventory {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr reserved,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Ansi,ExactSpelling=true)] static extern IntPtr GetProcAddress(IntPtr module,string name);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr Create();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Initialize(IntPtr handle);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOption(IntPtr handle,[MarshalAs(UnmanagedType.LPUTF8Str)] string name,[MarshalAs(UnmanagedType.LPUTF8Str)] string value);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr GetProperty(IntPtr handle,[MarshalAs(UnmanagedType.LPUTF8Str)] string name);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Free(IntPtr value);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Destroy(IntPtr handle);
  static T Function<T>(IntPtr module,string name) where T:Delegate {
    IntPtr address=GetProcAddress(module,name);
    if(address==IntPtr.Zero)throw new InvalidOperationException("Missing libmpv API: "+name);
    return Marshal.GetDelegateForFunctionPointer<T>(address);
  }
  public static Dictionary<string,string> Versions(string path) {
    IntPtr module=LoadLibraryEx(path,IntPtr.Zero,0x1100);
    if(module==IntPtr.Zero)throw new Win32Exception();
    IntPtr handle=IntPtr.Zero;
    Destroy destroy=null;
    try {
      var create=Function<Create>(module,"mpv_create");
      var initialize=Function<Initialize>(module,"mpv_initialize");
      var option=Function<SetOption>(module,"mpv_set_option_string");
      var property=Function<GetProperty>(module,"mpv_get_property_string");
      var free=Function<Free>(module,"mpv_free");
      destroy=Function<Destroy>(module,"mpv_terminate_destroy");
      handle=create();
      if(handle==IntPtr.Zero)throw new InvalidOperationException("mpv_create failed");
      // Do not read user config, run scripts, open media, create a window or use an audio device.
      foreach(var pair in new[]{new[]{"config","no"},new[]{"load-scripts","no"},new[]{"ao","null"},new[]{"vo","null"}})
        if(option(handle,pair[0],pair[1])<0)throw new InvalidOperationException("mpv inventory option failed: "+pair[0]);
      if(initialize(handle)<0)throw new InvalidOperationException("mpv_initialize failed");
      var result=new Dictionary<string,string>();
      foreach(string name in new[]{"mpv-version","ffmpeg-version"}) {
        IntPtr value=property(handle,name);
        if(value==IntPtr.Zero)throw new InvalidOperationException("libmpv property unavailable: "+name);
        try {result.Add(name,Marshal.PtrToStringUTF8(value));} finally {free(value);}
      }
      return result;
    } finally {if(handle!=IntPtr.Zero&&destroy!=null)destroy(handle);FreeLibrary(module);}
  }
}
'@
}

$electron = Invoke-HiddenInventoryCommand $AppPath @('-e', 'console.log(JSON.stringify(process.versions))') -ElectronNode
$electronVersions = $electron.stdout | ConvertFrom-Json
if (-not $electronVersions.electron -or -not $electronVersions.chrome -or -not $electronVersions.node -or -not $electronVersions.v8) { throw 'Electron did not expose actual electron/chrome/node/v8 runtime versions.' }
$mpvVersions = [NativeMpvInventory]::Versions($MpvDllPath)
$javaFile = (Get-Command java -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$java = Invoke-HiddenInventoryCommand $javaFile @('-version')
$nodeFile = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$node = Invoke-HiddenInventoryCommand $nodeFile @('--version')
$inventory = [ordered]@{
  schemaVersion=1
  observedAt=[DateTime]::UtcNow.ToString('o')
  scope=$(if ($packaged) { 'packaged-runtime' } else { 'downloaded-runtime-inventory' })
  electron=@{ file="Free New Desk.exe"; sha256=(Get-FileHash -LiteralPath $AppPath -Algorithm SHA256).Hash.ToLowerInvariant(); versions=$electronVersions }
  mpv=@{ file="native/player-host/libmpv-2.dll"; sha256=(Get-FileHash -LiteralPath $MpvDllPath -Algorithm SHA256).Hash.ToLowerInvariant(); version=$mpvVersions['mpv-version']; ffmpegVersion=$mpvVersions['ffmpeg-version'] }
  java=@{ file="java (external runtime)"; version=($java.stderr + $java.stdout).Trim(); scope='external host runtime; Java is not bundled' }
  buildNode=@{ file="node (build runtime)"; version=$node.stdout }
  limits=@('Observed versions and hashes identify binaries; npm audit results do not prove native runtimes have no vulnerabilities.', 'Version-only advisory matching cannot prove which patches a provider backported into a git build.')
}
$evidenceFile = [IO.Path]::GetFullPath($EvidencePath)
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($evidenceFile))
$json = $inventory | ConvertTo-Json -Depth 8
$json | Set-Content -LiteralPath $evidenceFile -Encoding utf8
Write-Output $json
