$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
Write-Host "Starting server on http://localhost:$port/"
Write-Host "Also available on http://127.0.0.1:$port/"
Write-Host "Press Ctrl+C to stop"
try {
    $listener.Start()
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $path = $context.Request.Url.AbsolutePath
        if ($path -eq "/") { $path = "/index.html" }
        $filePath = Join-Path $PSScriptRoot $path.TrimStart("/")
        $filePath = $filePath -replace "/", "\"
        if (Test-Path $filePath) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $mime = @{
                ".html" = "text/html; charset=utf-8"
                ".js" = "application/javascript"
                ".json" = "application/json"
                ".css" = "text/css"
            }
            if (-not $mime.ContainsKey($ext)) {
                $mime = "text/plain"
            } else {
                $mime = $mime[$ext]
            }
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $context.Response.ContentType = $mime
            $context.Response.ContentLength64 = $content.Length
            $context.Response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $context.Response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
            $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $context.Response.Close()
    }
} finally {
    $listener.Stop()
}
