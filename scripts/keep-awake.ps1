# Keep Windows from sleeping while this window is open.
# Lock screen (Win+L) is fine. Sleep / hibernate would kill API + tunnel.
#
# Usage: double-click scripts\keep-awake.bat  (or run alongside start-vercel-pc.bat)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeWake {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_AWAYMODE_REQUIRED = 0x00000040;
}
"@

$null = [NativeWake]::SetThreadExecutionState(
  [NativeWake]::ES_CONTINUOUS -bor [NativeWake]::ES_SYSTEM_REQUIRED -bor [NativeWake]::ES_AWAYMODE_REQUIRED
)

Write-Host 'PC kept awake (no sleep) while this window stays open.' -ForegroundColor Green
Write-Host '  Lock (Win+L): OK - API + tunnel keep running'
Write-Host '  Sleep / Hibernate: blocked by this script'
Write-Host 'Close this window when the team no longer needs the backend.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Ctrl+C to stop.' -ForegroundColor DarkGray

try {
  while ($true) {
    Start-Sleep -Seconds 60
    $null = [NativeWake]::SetThreadExecutionState(
      [NativeWake]::ES_CONTINUOUS -bor [NativeWake]::ES_SYSTEM_REQUIRED -bor [NativeWake]::ES_AWAYMODE_REQUIRED
    )
  }
} finally {
  $null = [NativeWake]::SetThreadExecutionState([NativeWake]::ES_CONTINUOUS)
  Write-Host 'Wake request released.' -ForegroundColor DarkYellow
}
