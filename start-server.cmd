@echo off
setlocal
cd /d "%~dp0"
echo Starte Vite Dev Server auf http://127.0.0.1:5173 ...
npm run dev -- --host 127.0.0.1 --port 5173
if errorlevel 1 (
  echo.
  echo Fehler beim Starten des Servers.
  pause
)
