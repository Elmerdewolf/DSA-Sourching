@echo off
echo Starting server on http://localhost:8080/
echo Press Ctrl+C to stop
powershell -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
