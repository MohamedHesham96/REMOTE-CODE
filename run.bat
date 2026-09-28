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

REM ── فحص وتثبيت OpenCode CLI ──
REM يتحقق من وجود opencode في PATH وإن لم يكن موجودًا أو كان أقدم من v2
REM يقوم بتثبيته تلقائيًا. يُستدعى من قسمي prod و dev.
:ensure-opencode-cli
where opencode >nul 2>&1
if errorlevel 1 (
  echo OpenCode CLI not found — installing...
  call npm install -g @opencode/cli
  if errorlevel 1 (
    echo [ERROR] Failed to install OpenCode CLI. Install manually:
    echo   npm install -g @opencode/cli
    pause
    exit /b 1
  )
  goto :eof
)
REM التحقق من النسخة — v1 لا يدعم serve --service
for /f "tokens=*" %%v in ('opencode --version 2^>^&1') do set "OC_VERSION=%%v"
echo %OC_VERSION% | findstr /b "2." >nul 2>&1
if errorlevel 1 (
  echo OpenCode CLI %OC_VERSION% is installed but v2 is required — upgrading...
  call npm install -g @opencode/cli@latest
  if errorlevel 1 (
    echo [ERROR] Failed to upgrade OpenCode CLI. Upgrade manually:
    echo   npm install -g @opencode/cli@latest
    pause
    exit /b 1
  )
)
goto :eof
