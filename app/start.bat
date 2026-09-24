@echo off
cd /d "%~dp0"
start "Personal Finance Server" /min python serve.py 8642
timeout /t 2 /nobreak >nul
start "" http://localhost:8642
