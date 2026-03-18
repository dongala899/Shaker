param(
  [int]$Port = 8080,
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = if ([string]::IsNullOrWhiteSpace($Root)) {
  Split-Path -Parent $scriptRoot
} else {
  (Resolve-Path -LiteralPath $Root).Path
}

$projectRoot = [System.IO.Path]::GetFullPath($projectRoot)
$serverScript = Join-Path $scriptRoot "start-localhost.ps1"
$pythonServerScript = Join-Path $scriptRoot "start-localhost.py"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$baseUrl = "http://localhost:$Port/"
$appUrl = "${baseUrl}index.html?forceLogin=1&source=shortcut"
$probeUrl = "${baseUrl}index.html"
$expectedMarker = "DigiDat InfoSystems"
$logDir = Join-Path $env:TEMP "Shaker"
$stdoutLogPath = Join-Path $logDir ("server-{0}.out.log" -f $Port)
$stderrLogPath = Join-Path $logDir ("server-{0}.err.log" -f $Port)

function Show-LaunchError {
  param([string]$Message)

  try {
    $shell = New-Object -ComObject WScript.Shell
    $shell.Popup($Message, 0, "Shaker", 16) | Out-Null
  }
  catch {
    Write-Error $Message
  }
}

function Get-ServerProbe {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return [pscustomobject]@{
      Reachable = $true
      StatusCode = [int]$response.StatusCode
      Content = [string]$response.Content
    }
  } catch {
    return [pscustomobject]@{
      Reachable = $false
      StatusCode = 0
      Content = ""
    }
  }
}

function Test-ShakerServer {
  param([string]$Url, [string]$Marker)

  $probe = Get-ServerProbe -Url $Url
  return $probe.Reachable -and $probe.StatusCode -eq 200 -and $probe.Content -like "*$Marker*"
}

function Resolve-PythonLauncher {
  $candidates = @(
    @{ FilePath = "py.exe"; VersionArgs = @("-3", "--version"); PrefixArgs = @("-3") },
    @{ FilePath = "py"; VersionArgs = @("-3", "--version"); PrefixArgs = @("-3") },
    @{ FilePath = "python.exe"; VersionArgs = @("--version"); PrefixArgs = @() },
    @{ FilePath = "python"; VersionArgs = @("--version"); PrefixArgs = @() }
  )

  foreach ($candidate in $candidates) {
    try {
      $versionArgs = @($candidate.VersionArgs)
      $versionOutput = & $candidate.FilePath @versionArgs 2>$null
      if ($LASTEXITCODE -eq 0) {
        return [pscustomobject]@{
          FilePath = $candidate.FilePath
          PrefixArgs = $candidate.PrefixArgs
        }
      }
    }
    catch {
      # Try the next Python launcher candidate.
    }
  }

  return $null
}

function Test-LoopbackPortAvailable {
  param([int]$ProbePort)

  $probeListener = $null

  try {
    $probeListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $ProbePort)
    $probeListener.Start()
    return $true
  }
  catch {
    return $false
  }
  finally {
    if ($probeListener) {
      try {
        $probeListener.Stop()
      }
      catch {
        # Ignore probe cleanup failures.
      }
    }
  }
}

function Reset-LaunchLogs {
  param(
    [string[]]$Paths
  )

  if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }

  foreach ($path in $Paths) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

function Get-LaunchFailureMessage {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [string]$ErrorLogPath,
    [string]$OutputLogPath,
    [string]$LauncherLabel = ""
  )

  $details = @()

  if ($Process) {
    try {
      $Process.Refresh()
      if ($Process.HasExited) {
        $details += "Server process exited with code $($Process.ExitCode)."
      }
    }
    catch {
      # Ignore process refresh issues and fall back to log contents.
    }
  }

  foreach ($path in @($ErrorLogPath, $OutputLogPath)) {
    if (Test-Path -LiteralPath $path) {
      $content = Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      } | Select-Object -First 8

      if ($content) {
        $details += $content
      }
    }
  }

  if ($details.Count -gt 0) {
    if (-not [string]::IsNullOrWhiteSpace($LauncherLabel)) {
      $details = @("Launcher: $LauncherLabel") + $details
    }
    return "Shaker server could not be started on $Url`n$($details -join "`n")`nLog: $ErrorLogPath"
  }

  if (-not [string]::IsNullOrWhiteSpace($LauncherLabel)) {
    return "Shaker server could not be started on $Url using $LauncherLabel. Log: $ErrorLogPath"
  }

  return "Shaker server could not be started on $Url. Log: $ErrorLogPath"
}

function Open-AppInBrowser {
  param([string]$Url)

  $openAttempts = @(
    {
      $shell = New-Object -ComObject WScript.Shell
      $shell.Run($Url, 1, $false) | Out-Null
    },
    { Start-Process -FilePath "rundll32.exe" -ArgumentList "url.dll,FileProtocolHandler $Url" -WindowStyle Hidden | Out-Null },
    { Start-Process -FilePath "cmd.exe" -ArgumentList "/c start `"`" `"$Url`"" -WindowStyle Hidden | Out-Null },
    { Start-Process -FilePath "explorer.exe" -ArgumentList $Url | Out-Null },
    { Start-Process -FilePath $Url | Out-Null }
  )

  foreach ($attempt in $openAttempts) {
    try {
      & $attempt
      return
    }
    catch {
      # Try the next Windows shell method.
    }
  }

  throw "Shaker started, but the browser could not be opened automatically. Open $Url manually."
}

function Wait-ForExpectedServer {
  param(
    [string]$Url,
    [string]$Marker,
    [System.Diagnostics.Process]$Process,
    [switch]$AllowExistingServer
  )

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-ShakerServer -Url $Url -Marker $Marker) {
      return $true
    }

    $probe = Get-ServerProbe -Url $Url
    if ($probe.Reachable -and -not ($probe.Content -like "*$Marker*")) {
      if ($AllowExistingServer) {
        return $false
      }
      throw "Port $Port is serving another application. Shaker cannot start on that port."
    }

    if ($Process) {
      try {
        $Process.Refresh()
        if ($Process.HasExited) {
          return $false
        }
      }
      catch {
        # Ignore process refresh issues and continue polling.
      }
    }
  }

  return $false
}

try {
  if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    throw "Server script not found: $serverScript"
  }

  $existingProbe = Get-ServerProbe -Url $probeUrl
  if ($existingProbe.Reachable -and -not ($existingProbe.Content -like "*$expectedMarker*")) {
    $existingShakerReady = Wait-ForExpectedServer -Url $probeUrl -Marker $expectedMarker -Process $null -AllowExistingServer
    if (-not $existingShakerReady) {
      exit 0
    }
  }

  if (-not (Test-ShakerServer -Url $probeUrl -Marker $expectedMarker)) {
    if (-not $existingProbe.Reachable -and -not (Test-LoopbackPortAvailable -ProbePort $Port)) {
      $existingShakerReady = Wait-ForExpectedServer -Url $probeUrl -Marker $expectedMarker -Process $null -AllowExistingServer
      if (-not $existingShakerReady) {
        exit 0
      }
    }

    if (-not (Test-ShakerServer -Url $probeUrl -Marker $expectedMarker)) {
      Reset-LaunchLogs -Paths @($stdoutLogPath, $stderrLogPath)
      $pythonLauncher = Resolve-PythonLauncher
      $launcherLabel = "built-in PowerShell server"
      $argumentLine = "-NoProfile -ExecutionPolicy Bypass -File `"$serverScript`" -Port $Port -Root `"$projectRoot`""
      $serverProcess = Start-Process -FilePath $powershellExe -ArgumentList $argumentLine -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath -PassThru
      $serverStarted = Wait-ForExpectedServer -Url $probeUrl -Marker $expectedMarker -Process $serverProcess

      if (-not $serverStarted -and $pythonLauncher -and (Test-Path -LiteralPath $pythonServerScript -PathType Leaf)) {
        try {
          if ($serverProcess -and -not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force
          }
        }
        catch {
          # Ignore failures while switching to the managed Python fallback.
        }

        Reset-LaunchLogs -Paths @($stdoutLogPath, $stderrLogPath)
        $launcherLabel = "$($pythonLauncher.FilePath) start-localhost.py"
        $serverArgs = @($pythonLauncher.PrefixArgs + @("-u", $pythonServerScript, "--port", $Port.ToString(), "--root", $projectRoot))
        $serverProcess = Start-Process -FilePath $pythonLauncher.FilePath -ArgumentList $serverArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath -PassThru
        $serverStarted = Wait-ForExpectedServer -Url $probeUrl -Marker $expectedMarker -Process $serverProcess
      }

      if (-not $serverStarted -and $pythonLauncher) {
        try {
          if ($serverProcess -and -not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force
          }
        }
        catch {
          # Ignore failures while switching to the plain Python fallback.
        }

        Reset-LaunchLogs -Paths @($stdoutLogPath, $stderrLogPath)
        $launcherLabel = "$($pythonLauncher.FilePath) -m http.server"
        $plainPythonArgs = @($pythonLauncher.PrefixArgs + @("-m", "http.server", $Port.ToString(), "--bind", "127.0.0.1"))
        $serverProcess = Start-Process -FilePath $pythonLauncher.FilePath -ArgumentList $plainPythonArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath -PassThru
        $serverStarted = Wait-ForExpectedServer -Url $probeUrl -Marker $expectedMarker -Process $serverProcess
      }

      if (-not $serverStarted) {
        throw (Get-LaunchFailureMessage -Url $baseUrl -Process $serverProcess -ErrorLogPath $stderrLogPath -OutputLogPath $stdoutLogPath -LauncherLabel $launcherLabel)
      }
    }
  }

  Open-AppInBrowser -Url $appUrl
}
catch {
  Show-LaunchError -Message $_.Exception.Message
  exit 1
}
