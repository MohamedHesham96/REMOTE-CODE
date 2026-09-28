@echo off
setlocal EnableExtensions
REM OpenCode Mobile PWA - launcher (default: dev on 5173)
REM Usage: run.bat         = start dev mode (backend + Vite on 5173)
REM        run.bat prod    = build + start prod (single port APP_PORT, default 7171)

cd /d "%~dp0"

if /i "%1"=="prod" goto :prod
goto :dev

:prod
set "APP_PORT=7171"
set "OPENCODE_SERVER_URL="
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "APP_PORT=%%b"
    if "%%a"=="OPENCODE_SERVER_URL" set "OPENCODE_SERVER_URL=%%b"
  )
)
title OpenCode Mobile PWA - Prod :%APP_PORT%

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

REM The backend starts the OpenCode CLI locally - skip this when using an external server.
if not defined OPENCODE_SERVER_URL call :ensure-opencode-cli

REM Clean up obsolete firewall rules from previous setup (silent, best effort).
netsh advfirewall firewall delete rule name="PWA Backend 8787" >nul 2>&1
netsh advfirewall firewall delete rule name="PWA Backend 7171" >nul 2>&1

REM Ensure firewall rule for the prod port (needs Admin; warn and continue if it fails).
netsh advfirewall firewall show rule name="PWA Prod %APP_PORT%" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="PWA Prod %APP_PORT%" dir=in action=allow protocol=TCP localport=%APP_PORT% >nul 2>&1
  if errorlevel 1 echo [NOTE] Could not add firewall rule for port %APP_PORT% automatically - if the phone cannot connect, open it manually or run as Administrator.
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
    if "%%a"=="APP_PORT" set "APP_PORT=%%b"
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
echo Production server will listen on port %APP_PORT%.
echo NOTE: prod mode serves everything on %APP_PORT% only - port 5173 is dev-only
echo and stays closed here. This is normal. Open %APP_PORT%, not 5173.
echo From your phone (same Wi-Fi), open one of:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   - http://%%b:%APP_PORT%
)
echo Local: http://localhost:%APP_PORT%
echo Requirements: same Wi-Fi, no VPN, firewall rule open.
echo The backend prints the exact addresses after start.
echo.
echo Starting prod server (Ctrl+C to stop)...
echo Opening http://localhost:%APP_PORT% in your browser...
start "" "http://localhost:%APP_PORT%"
call npm start
pause
exit /b %ERRORLEVEL%

:dev
set "DEV_PORT=5173"
set "BACKEND_PORT=7171"
set "OPENCODE_SERVER_URL="
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "BACKEND_PORT=%%b"
    if "%%a"=="OPENCODE_SERVER_URL" set "OPENCODE_SERVER_URL=%%b"
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

REM The backend starts the OpenCode CLI locally - skip this when using an external server.
if not defined OPENCODE_SERVER_URL call :ensure-opencode-cli

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

REM ---------------------------------------------------------------------------
REM ensure-opencode-cli: install or upgrade the OpenCode CLI to v2.
REM v2 is required because the backend runs "opencode serve --service" and
REM v1 has no such flag (it exits with code 1 and no useful message).
REM The v1 CLI ships as the "opencode-ai" package and owns the same "opencode"
REM binary name, so npm refuses to overwrite it (EEXIST) until that old
REM package is removed first.
:ensure-opencode-cli
setlocal EnableDelayedExpansion
set "OC_VERSION="
for /f "delims=" %%v in ('opencode --version 2^>^&1') do if not defined OC_VERSION set "OC_VERSION=%%v"
REM v2 prints "opencode v2.0.18" while v1 printed a bare "1.18.32" - strip the
REM prefixes instead of assuming one fixed format, or a good v2 looks broken.
set "OC_VERSION=!OC_VERSION:opencode v=!"
set "OC_VERSION=!OC_VERSION:OpenCode v=!"
set "OC_VERSION=!OC_VERSION:v=!"
if not defined OC_VERSION set "OC_VERSION=(not found)"
if "!OC_VERSION:~0,2!"=="2." goto :eof
echo OpenCode CLI !OC_VERSION! found, but v2 is required - reinstalling...
call npm uninstall -g opencode-ai
call npm install -g @opencode/cli@latest
if errorlevel 1 (
  echo [ERROR] Failed to install the OpenCode CLI. Fix it manually, then retry:
  echo   npm uninstall -g opencode-ai
  echo   npm install -g @opencode/cli@latest
  endlocal
  pause
  exit /b 1
)
endlocal & goto :eof
