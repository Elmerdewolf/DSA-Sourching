@echo off
echo 正在启动报价管理系统...
echo.

cd /d "%~dp0"

REM 优先使用项目内置 PowerShell 服务，无需 Python/Node
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo 检测到 8080 端口已有服务，直接打开页面...
) else (
    echo 正在启动内置服务 start-server.ps1 ...
    start "QuoteServer" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
    ping 127.0.0.1 -n 3 >nul
)

start http://localhost:8080
exit /b

