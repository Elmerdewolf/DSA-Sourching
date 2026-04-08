# Simple HTTP server for quote system
$port = 8080
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Host "Server started at http://localhost:$port"
Write-Host "Also available at http://127.0.0.1:$port"
Write-Host "Press Ctrl+C to stop"

# Open browser
Start-Process "http://127.0.0.1:$port"

# Handle requests
try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $path = $ctx.Request.Url.AbsolutePath
        if ($path -eq "/") { $path = "/index.html" }
        $filePath = Join-Path $root $path.TrimStart("/")

        if (Test-Path $filePath) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $mimeTypes = @{
                ".html" = "text/html;charset=utf-8"
                ".js" = "application/javascript"
                ".json" = "application/json"
                ".css" = "text/css"
            }
            $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "text/plain" }
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $ctx.Response.ContentType = $contentType
            $ctx.Response.ContentLength64 = $content.Length
            $ctx.Response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $ctx.Response.StatusCode = 404
            $body = "File not found: $path"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        $ctx.Response.Close()
    }
} finally {
    $listener.Stop()
}
