param(
  [int]$Port = 3000,
  [string]$Root = (Resolve-Path ".")
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path $Root).Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Serving $rootPath at http://127.0.0.1:$Port/"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".txt" = "text/plain; charset=utf-8"
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($requestPath)) {
      $requestPath = "index.html"
    }

    $candidate = Join-Path $rootPath $requestPath
    $resolved = $null
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $resolved = (Resolve-Path -LiteralPath $candidate).Path
    }

    if (-not $resolved -or -not $resolved.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
      $context.Response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
      continue
    }

    $extension = [IO.Path]::GetExtension($resolved).ToLowerInvariant()
    $context.Response.ContentType = $mimeTypes[$extension]
    if (-not $context.Response.ContentType) {
      $context.Response.ContentType = "application/octet-stream"
    }

    $bytes = [IO.File]::ReadAllBytes($resolved)
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
}
finally {
  $listener.Stop()
}
