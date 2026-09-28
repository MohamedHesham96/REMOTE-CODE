@echo off
setlocal EnableExtensions
REM OpenCode Mobile PWA - launcher (default: dev on 5173)
REM Usage: run.bat         = start dev mode (backend + Vite on 5173)
REM        run.bat prod    = build + start prod (single port APP_PORT, default 7171)

cd /d "%~dp0"

if /i "%1"=="prod" goto :prod
goto :dev

:prod
set "PORT=7171"
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "PORT=%%b"
  )
)
title OpenCode Mobile PWA - Prod :%PORT%

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Install Node 20+ and retry.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found in PATH. Install Node 20+ and retry.
  pause
  exit /b 1
)

REM Clean up obsolete firewall rules from previous setup (silent, best effort).
netsh advfirewall firewall delete rule name="PWA Backend 8787" >nul 2>&1
netsh advfirewall firewall delete rule name="PWA Backend 7171" >nul 2>&1

REM Ensure firewall rule for the prod port (needs Admin; warn and continue if it fails).
netsh advfirewall firewall show rule name="PWA Prod %PORT%" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="PWA Prod %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>&1
  if errorlevel 1 echo [NOTE] Could not add firewall rule for port %PORT% automatically - if the phone cannot connect, open it manually or run as Administrator.
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo Creating .env...
  call npm run setup
  if errorlevel 1 (
    echo [ERROR] npm run setup failed.
    pause
    exit /b 1
  )
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "PORT=%%b"
  )
)

echo Building for production...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed. Fix the errors above and retry.
  pause
  exit /b 1
)

echo.
echo Production server will listen on port %PORT%.
echo NOTE: prod mode serves everything on %PORT% only - port 5173 is dev-only
echo and stays closed here. This is normal. Open %PORT%, not 5173.
echo From your phone (same Wi-Fi), open one of:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   - http://%%b:%PORT%
)
echo Local: http://localhost:%PORT%
echo Requirements: same Wi-Fi, no VPN, firewall rule open.
echo The backend prints the exact addresses after start.
echo.
echo Starting prod server (Ctrl+C to stop)...
echo Opening http://localhost:%PORT% in your browser...
start "" "http://localhost:%PORT%"
call npm start
pause
exit /b %ERRORLEVEL%

:dev
set "DEV_PORT=5173"
set "BACKEND_PORT=7171"
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "BACKEND_PORT=%%b"
  )
)
title OpenCode Mobile PWA - Dev

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Install Node 20+ and retry.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found in PATH. Install Node 20+ and retry.
  pause
  exit /b 1
)

netsh advfirewall firewall show rule name="PWA Dev %DEV_PORT%" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="PWA Dev %DEV_PORT%" dir=in action=allow protocol=TCP localport=%DEV_PORT% >nul 2>&1
  if errorlevel 1 echo [NOTE] Could not add firewall rule for port %DEV_PORT% automatically - if the phone cannot connect, open it manually or run as Administrator.
)
netsh advfirewall firewall show rule name="PWA Prod %BACKEND_PORT%" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="PWA Prod %BACKEND_PORT%" dir=in action=allow protocol=TCP localport=%BACKEND_PORT% >nul 2>&1
  if errorlevel 1 echo [NOTE] Could not add firewall rule for port %BACKEND_PORT% automatically - if the phone cannot connect, open it manually or run as Administrator.
)

echo.
echo Dev frontend on port %DEV_PORT% - from your phone (same Wi-Fi), open one of:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   - http://%%b:%DEV_PORT%
)
echo Backend on port %BACKEND_PORT%.
echo Prod mode (single port, no 5173): run.bat prod
echo.

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo Creating .env...
  call npm run setup
  if errorlevel 1 (
    echo [ERROR] npm run setup failed.
    pause
    exit /b 1
  )
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "BACKEND_PORT=%%b"
  )
)
echo Opening http://localhost:%DEV_PORT% in your browser...
start "" "http://localhost:%DEV_PORT%"
call npm run dev
pause
exit /b %ERRORLEVEL%
