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
$shutdownDelayMs = 4000
$shutdownAt = $null
$activeClients = New-Object 'System.Collections.Generic.HashSet[string]'
$storageDirectory = Join-Path $projectRoot "app-data"
$storageFilePath = Join-Path $storageDirectory "shaker-storage.json"

$contentTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".csv" = "text/csv; charset=utf-8"
  ".gif" = "image/gif"
  ".htm" = "text/html; charset=utf-8"
  ".html" = "text/html; charset=utf-8"
  ".jpeg" = "image/jpeg"
  ".jpg" = "image/jpeg"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
  ".txt" = "text/plain; charset=utf-8"
  ".webp" = "image/webp"
}

function Get-HttpStatusText {
  param([int]$StatusCode)

  switch ($StatusCode) {
    200 { "OK" }
    400 { "Bad Request" }
    403 { "Forbidden" }
    404 { "Not Found" }
    405 { "Method Not Allowed" }
    500 { "Internal Server Error" }
    default { "OK" }
  }
}

function Write-HttpResponse {
  param(
    [Parameter(Mandatory = $true)][System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode = 200,
    [byte[]]$Body = @(),
    [string]$ContentType = "text/plain; charset=utf-8",
    [switch]$HeadOnly
  )

  $statusText = Get-HttpStatusText -StatusCode $StatusCode
  $headers = @(
    "HTTP/1.1 $StatusCode $statusText",
    "Content-Type: $ContentType",
    "Cache-Control: no-store",
    "Content-Length: $($Body.Length)",
    "Connection: close",
    ""
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

function Write-PlainResponse {
  param(
    [Parameter(Mandatory = $true)][System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$Body,
    [switch]$HeadOnly
  )

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  Write-HttpResponse -Stream $Stream -StatusCode $StatusCode -Body $bytes -ContentType "text/plain; charset=utf-8" -HeadOnly:$HeadOnly
}

function Write-JsonResponse {
  param(
    [Parameter(Mandatory = $true)][System.Net.Sockets.NetworkStream]$Stream,
    [hashtable]$Body,
    [int]$StatusCode = 200,
    [switch]$HeadOnly
  )

  $json = $Body | ConvertTo-Json -Depth 4 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Write-HttpResponse -Stream $Stream -StatusCode $StatusCode -Body $bytes -ContentType "application/json; charset=utf-8" -HeadOnly:$HeadOnly
}

function ConvertTo-HashtableRecursive {
  param($Value)

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) {
      $table[[string]$key] = ConvertTo-HashtableRecursive -Value $Value[$key]
    }
    return $table
  }

  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $table[$property.Name] = ConvertTo-HashtableRecursive -Value $property.Value
    }
    return $table
  }

  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    $list = New-Object System.Collections.ArrayList
    foreach ($item in $Value) {
      [void]$list.Add((ConvertTo-HashtableRecursive -Value $item))
    }
    return ,$list.ToArray()
  }

  return $Value
}

function Get-ManagementSnapshot {
  return @{
    managed = $true
    activeClients = $activeClients.Count
    shutdownDelayMs = $shutdownDelayMs
    fileBackedStorage = $true
  }
}

function Read-StorageSnapshot {
  if (-not (Test-Path -LiteralPath $storageFilePath)) {
    return @{}
  }

  try {
    $raw = Get-Content -LiteralPath $storageFilePath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return @{}
    }

    $parsed = ConvertTo-HashtableRecursive -Value ($raw | ConvertFrom-Json)
    if ($parsed -and $parsed.ContainsKey("storage") -and $parsed.storage -is [hashtable]) {
      return $parsed.storage
    }
  } catch {
    return @{}
  }

  return @{}
}

function Write-StorageSnapshot {
  param([hashtable]$Storage)

  if (-not (Test-Path -LiteralPath $storageDirectory)) {
    New-Item -ItemType Directory -Path $storageDirectory -Force | Out-Null
  }

  $payload = @{
    updatedAt = (Get-Date).ToString("o")
    storage = if ($Storage) { $Storage } else { @{} }
  }

  ($payload | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $storageFilePath -Encoding UTF8
}

function Register-ServerClient {
  param([string]$ClientId)

  if (-not [string]::IsNullOrWhiteSpace($ClientId)) {
    $activeClients.Add($ClientId) | Out-Null
  }
  $script:shutdownAt = $null
  return Get-ManagementSnapshot
}

function Release-ServerClient {
  param([string]$ClientId)

  if (-not [string]::IsNullOrWhiteSpace($ClientId)) {
    $activeClients.Remove($ClientId) | Out-Null
  }
  if ($activeClients.Count -eq 0) {
    $script:shutdownAt = (Get-Date).AddMilliseconds($shutdownDelayMs)
  }
  return Get-ManagementSnapshot
}

function Request-ServerShutdown {
  $activeClients.Clear()
  $script:shutdownAt = (Get-Date).AddMilliseconds(250)
  return Get-ManagementSnapshot
}

function Get-RequestInfo {
  param([string]$RawUrl)

  $path = if ([string]::IsNullOrWhiteSpace($RawUrl)) { "/" } else { $RawUrl }
  $query = @{}

  if ($path.Contains("?")) {
    $parts = $path.Split("?", 2)
    $path = $parts[0]
    $queryString = $parts[1]

    foreach ($pair in $queryString.Split("&")) {
      if ([string]::IsNullOrWhiteSpace($pair)) { continue }
      $segments = $pair.Split("=", 2)
      $key = [System.Uri]::UnescapeDataString($segments[0])
      $value = if ($segments.Length -gt 1) { [System.Uri]::UnescapeDataString($segments[1]) } else { "" }
      if (-not $query.ContainsKey($key)) {
        $query[$key] = @()
      }
      $query[$key] += $value
    }
  }

  return @{
    Path = [System.Uri]::UnescapeDataString($path)
    Query = $query
  }
}

function Get-QueryValue {
  param(
    [hashtable]$Query,
    [string]$Name
  )

  if (-not $Query.ContainsKey($Name)) { return "" }
  $values = $Query[$Name]
  if ($values -is [System.Array]) {
    return [string]($values | Select-Object -First 1)
  }
  return [string]$values
}

function Resolve-RequestPath {
  param([string]$RequestPath)

  $pathOnly = [string]$RequestPath
  $relativePath = $pathOnly.TrimStart("/").Replace("/", "\")

  if ([string]::IsNullOrWhiteSpace($relativePath)) {
    $relativePath = "index.html"
  }

  $targetPath = Join-Path $projectRoot $relativePath
  $fullPath = [System.IO.Path]::GetFullPath($targetPath)

  if (-not $fullPath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw [System.UnauthorizedAccessException]::new("Forbidden")
  }

  if (Test-Path -LiteralPath $fullPath -PathType Container) {
    $fullPath = Join-Path $fullPath "index.html"
  }

  return $fullPath
}

function Handle-ManagementRequest {
  param(
    [string]$Method,
    [string]$RequestPath,
    [hashtable]$Query,
    [System.Net.Sockets.NetworkStream]$Stream,
    [string]$RequestBody = ""
  )

  $normalizedPath = if ([string]::IsNullOrWhiteSpace($RequestPath)) { "/" } else { $RequestPath.TrimEnd("/") }
  if ($normalizedPath -eq "") { $normalizedPath = "/" }

  if (-not $normalizedPath.StartsWith("/__shaker__")) {
    return $false
  }

  $clientId = Get-QueryValue -Query $Query -Name "clientId"
  $headOnly = $Method -eq "HEAD"

  switch ($normalizedPath) {
    "/__shaker__/health" {
      $body = Get-ManagementSnapshot
      $body.ok = $true
      Write-JsonResponse -Stream $Stream -Body $body -HeadOnly:$headOnly
      return $true
    }
    "/__shaker__/config" {
      Write-JsonResponse -Stream $Stream -Body @{
        managed = $true
        shutdownDelayMs = $shutdownDelayMs
        loginUrl = "/index.html?forceLogin=1&source=shortcut"
        fileBackedStorage = $true
        storageUrl = "/__shaker__/storage"
      } -HeadOnly:$headOnly
      return $true
    }
    "/__shaker__/storage" {
      if ($Method -eq "GET" -or $Method -eq "HEAD") {
        Write-JsonResponse -Stream $Stream -Body @{
          ok = $true
          fileBacked = $true
          storage = Read-StorageSnapshot
        } -HeadOnly:$headOnly
        return $true
      }

      if ($Method -eq "POST") {
        try {
          $parsedBody = if ([string]::IsNullOrWhiteSpace($RequestBody)) {
            @{}
          } else {
            ConvertTo-HashtableRecursive -Value ($RequestBody | ConvertFrom-Json)
          }

          $storage = if ($parsedBody -and $parsedBody.ContainsKey("storage") -and $parsedBody.storage -is [hashtable]) {
            $parsedBody.storage
          } else {
            @{}
          }

          Write-StorageSnapshot -Storage $storage
          Write-JsonResponse -Stream $Stream -Body @{
            ok = $true
            fileBacked = $true
          }
        } catch {
          Write-JsonResponse -Stream $Stream -StatusCode 400 -Body @{
            ok = $false
            error = "Invalid storage payload."
          }
        }
        return $true
      }

      Write-PlainResponse -Stream $Stream -StatusCode 405 -Body "Method Not Allowed" -HeadOnly:$headOnly
      return $true
    }
    "/__shaker__/register" {
      $body = Register-ServerClient -ClientId $clientId
      $body.ok = $true
      Write-JsonResponse -Stream $Stream -Body $body -HeadOnly:$headOnly
      return $true
    }
    "/__shaker__/release" {
      $body = Release-ServerClient -ClientId $clientId
      $body.ok = $true
      Write-JsonResponse -Stream $Stream -Body $body -HeadOnly:$headOnly
      return $true
    }
    "/__shaker__/shutdown" {
      $body = Request-ServerShutdown
      $body.ok = $true
      Write-JsonResponse -Stream $Stream -Body $body -HeadOnly:$headOnly
      return $true
    }
    default {
      Write-PlainResponse -Stream $Stream -StatusCode 404 -Body "Not Found" -HeadOnly:$headOnly
      return $true
    }
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)

try {
  $listener.Start()
  Write-Host "Serving $projectRoot at http://localhost:$Port/"

  while ($true) {
    if ($shutdownAt -and (Get-Date) -ge $shutdownAt) {
      break
    }

    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 150
      continue
    }

    $client = $listener.AcceptTcpClient()
    $reader = $null
    $stream = $null

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        Write-PlainResponse -Stream $stream -StatusCode 400 -Body "Bad Request"
        continue
      }

      $contentLength = 0

      while ($true) {
        $headerLine = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($headerLine)) {
          break
        }
        if ($headerLine -match '^Content-Length:\s*(\d+)') {
          $contentLength = [int]$matches[1]
        }
      }

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2) {
        Write-PlainResponse -Stream $stream -StatusCode 400 -Body "Bad Request"
        continue
      }

      $method = $parts[0].ToUpperInvariant()
      $rawUrl = $parts[1]
      $requestBody = ""

      if ($method -ne "GET" -and $method -ne "HEAD" -and $method -ne "POST") {
        Write-PlainResponse -Stream $stream -StatusCode 405 -Body "Method Not Allowed"
        continue
      }

      if ($contentLength -gt 0) {
        $bodyChars = New-Object char[] $contentLength
        $charsRead = 0
        while ($charsRead -lt $contentLength) {
          $read = $reader.Read($bodyChars, $charsRead, $contentLength - $charsRead)
          if ($read -le 0) { break }
          $charsRead += $read
        }
        $requestBody = New-Object string ($bodyChars, 0, $charsRead)
      }

      $requestInfo = Get-RequestInfo -RawUrl $rawUrl
      if (Handle-ManagementRequest -Method $method -RequestPath $requestInfo.Path -Query $requestInfo.Query -Stream $stream -RequestBody $requestBody) {
        continue
      }

      if ($method -eq "POST") {
        Write-PlainResponse -Stream $stream -StatusCode 405 -Body "Method Not Allowed"
        continue
      }

      try {
        $fullPath = Resolve-RequestPath -RequestPath $requestInfo.Path
      }
      catch [System.UnauthorizedAccessException] {
        Write-PlainResponse -Stream $stream -StatusCode 403 -Body "Forbidden" -HeadOnly:($method -eq "HEAD")
        continue
      }

      if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        Write-PlainResponse -Stream $stream -StatusCode 404 -Body "Not Found" -HeadOnly:($method -eq "HEAD")
        continue
      }

      $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
      $contentType = if ($contentTypes.ContainsKey($extension)) {
        $contentTypes[$extension]
      } else {
        "application/octet-stream"
      }

      $body = if ($method -eq "HEAD") { @() } else { [System.IO.File]::ReadAllBytes($fullPath) }
      Write-HttpResponse -Stream $stream -StatusCode 200 -Body $body -ContentType $contentType -HeadOnly:($method -eq "HEAD")
    }
    catch {
      if ($stream) {
        try {
          Write-PlainResponse -Stream $stream -StatusCode 500 -Body ("Server Error: " + $_.Exception.Message)
        }
        catch {
          # Ignore secondary socket errors.
        }
      }
    }
    finally {
      if ($reader) { $reader.Dispose() }
      if ($stream) { $stream.Dispose() }
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
