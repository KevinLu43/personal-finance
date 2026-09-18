@echo off
cd /d "%~dp0"
start "Personal Finance Server" /min python -m http.server 8642
timeout /t 2 /nobreak >nul
start "" http://localhost:8642
