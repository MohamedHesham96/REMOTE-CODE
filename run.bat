@echo off
setlocal EnableExtensions
REM ==========================================================================
REM  RemoteCode - Launcher (Windows)
REM  --------------------------------------------------------------------------
REM  Usage: run.bat         = Development mode (backend + Vite on 5173)
REM         run.bat prod    = Production mode (build + single port APP_PORT)
REM         run.bat menu    = Interactive mode selection
REM         run.bat check   = Environment check only, then exit
REM  Any other argument prints a warning and starts Development (default).
REM  Backend console language: APP_LANG=en here (Arabic is the default
REM  when running npm commands manually or when APP_LANG is set explicitly).
REM ==========================================================================

REM UTF-8 output so status icons render correctly.
REM If this fails the script still works, just with plainer glyphs.
chcp 65001 >nul 2>&1

cd /d "%~dp0"

REM Backend console logs come out in English under this launcher.
REM Manual runs without APP_LANG keep the default Arabic output.
if not defined APP_LANG set "APP_LANG=en"

REM ANSI colors (Windows Terminal, VS Code terminal and the Win10+ console).
REM Unknown sequences are ignored on older hosts - text stays readable.
for /F "tokens=1,2 delims=#" %%a in ('"prompt #$H#$E# & echo on & for %%b in (1) do rem"') do set "ESC=%%b"
set "C_RESET=%ESC%[0m"
set "C_BOLD=%ESC%[1m"
set "C_DIM=%ESC%[2m"
set "C_RED=%ESC%[91m"
set "C_GREEN=%ESC%[92m"
set "C_YELLOW=%ESC%[93m"
set "C_BLUE=%ESC%[94m"
set "C_CYAN=%ESC%[96m"
set "C_GRAY=%ESC%[90m"

set "ICON_OK=%C_GREEN%√"
set "ICON_RUN=%C_CYAN%●"
set "ICON_GO=%C_CYAN%→"
set "ICON_WARN=%C_YELLOW%!"
set "ICON_ERR=%C_RED%×"

if /i "%1"=="waitopen" goto :waitopen
if /i "%1"=="prod" goto :prod
if /i "%1"=="menu" goto :menu
if /i "%1"=="check" goto :check
if not "%1"=="" call :warn_box "Unknown option '%1' - starting Development (default)."
goto :dev

REM ==========================================================================
REM  PRESENTATION HELPERS
REM ==========================================================================
:banner
echo %C_CYAN%████   █████  █   █   ███   █████  █████          ████   ███   ████   █████
echo █   █  █      ██ ██  █   █    █    █             █      █   █  █   █  █
echo ████   ████   █ █ █  █   █    █    ████   █████  █      █   █  █   █  ████
echo █  █   █      █   █  █   █    █    █             █      █   █  █   █  █
echo █   █  █████  █   █   ███     █    █████          ████   ███   ████   █████%C_RESET%
echo.
goto :eof

REM Thin section header: call :section "TITLE"
:section
echo %C_BLUE%  --- %~1 ---%C_RESET%
echo.
goto :eof

REM Footer shown under every major screen.
:footer
echo %C_GRAY%  ------------------------------------------------------------
echo   RemoteCode  -  Launcher%C_RESET%
echo.
goto :eof

REM Warning panel (non-fatal): call :warn_box "message"
:warn_box
echo %ICON_WARN%%C_RESET%  WARNING
echo   %~1
echo.
goto :eof

REM Fatal error: prints a panel and pauses. It returns to the caller with
REM errorlevel 1, so every caller must follow it with "exit /b 1".
:fatal
echo %ICON_ERR%%C_RESET%  ERROR
echo   %~1
if not "%~2"=="" echo   %~2
echo.
echo   The technical output above is preserved for troubleshooting.
echo.
pause
exit /b 1

REM Real step progress with no fake delays: call :step_bar <done> <total> <label>
REM after a launcher step actually finishes. Labels must avoid % and ! chars.
:step_bar
setlocal EnableDelayedExpansion
set /a "pct=(%~1*100)/%~2"
set /a "fill=(%~1*10)/%~2"
set "bar="
for /L %%i in (1,1,10) do (
  if %%i leq !fill! ( set "bar=!bar!█" ) else ( set "bar=!bar!░" )
)
echo %C_CYAN%  [!bar!] !pct!%%  %~3%C_RESET%
endlocal & goto :eof

REM ==========================================================================
REM  ENVIRONMENT CHECK (every check is real - nothing is faked)
REM ==========================================================================
:env_check
call :section "SYSTEM CHECK"

where node >nul 2>&1
if errorlevel 1 (
  call :fatal "Node.js was not found in PATH." "Install Node.js 20 or newer, then retry."
  exit /b 1
)
set "NODE_V="
for /f "delims=" %%v in ('node --version 2^>nul') do if not defined NODE_V set "NODE_V=%%v"
echo %ICON_OK%%C_RESET%  Node.js            %NODE_V%

where npm >nul 2>&1
if errorlevel 1 (
  call :fatal "npm was not found in PATH." "Install Node.js 20 or newer, then retry."
  exit /b 1
)
set "NPM_V="
for /f "delims=" %%v in ('call npm --version 2^>nul') do if not defined NPM_V set "NPM_V=%%v"
echo %ICON_OK%%C_RESET%  npm                %NPM_V%

if not exist "package.json" (
  call :fatal "package.json not found." "Run this launcher from the project folder."
  exit /b 1
)
if not exist "server\index.ts" (
  call :fatal "server\index.ts not found." "Run this launcher from the project folder."
  exit /b 1
)
echo %ICON_OK%%C_RESET%  Project            found

if exist "node_modules" (
  echo %ICON_OK%%C_RESET%  Dependencies       ready
) else (
  echo %ICON_GO%%C_RESET%  Dependencies       installing...
  call npm install
  if errorlevel 1 (
    call :fatal "npm install failed." "Fix the errors above and retry."
    exit /b 1
  )
  echo %ICON_OK%%C_RESET%  Dependencies       installed
)

if exist ".env" (
  echo %ICON_OK%%C_RESET%  Configuration      .env found
) else (
  echo %ICON_GO%%C_RESET%  Configuration      creating .env...
  call npm run setup
  if errorlevel 1 (
    call :fatal "npm run setup failed." "Fix the errors above and retry."
    exit /b 1
  )
  echo %ICON_OK%%C_RESET%  Configuration      .env created
)
echo.
goto :eof

REM Read APP_PORT and OPENCODE_SERVER_URL from .env into BACKEND_PORT / OC_URL.
:read_env
set "BACKEND_PORT=7171"
set "OC_URL="
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "BACKEND_PORT=%%b"
    if "%%a"=="OPENCODE_SERVER_URL" set "OC_URL=%%b"
  )
)
goto :eof

REM Warn (don't fail) when the given local port is already occupied.
:port_check
netstat -ano 2>nul | findstr /C:":%~1 " | findstr /C:"LISTENING" >nul
if not errorlevel 1 (
  call :warn_box "Port %~1 is already in use - another instance may be running."
)
goto :eof

REM Quiet mode: LAN URLs are no longer auto-printed (backend startup is
REM silent too). Use ipconfig to find this machine's IPv4 on the same Wi-Fi.
:lan_urls
echo   From your phone ^(same Wi-Fi, no VPN^):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo %ICON_GO%%C_RESET%  http://%%b:%~1
)
echo   Local: %C_CYAN%http://localhost:%~1%C_RESET%
goto :eof

REM ==========================================================================
REM  INTERACTIVE MENU (additive - plain "run.bat" still starts Dev directly)
REM ==========================================================================
:menu
call :banner
echo %C_BOLD%  SELECT MODE%C_RESET%
echo.
echo   %C_CYAN%[1]%C_RESET%  Development
echo        Hot reload - debugging - port 5173
echo.
echo   %C_CYAN%[2]%C_RESET%  Production
echo        Optimized build - single port server
echo.
echo   %C_CYAN%[3]%C_RESET%  Environment check
echo        Verify tools and configuration only
echo.
echo   %C_CYAN%[Q]%C_RESET%  Quit
echo.
choice /C 123Q /N /M "  Select [1/2/3/Q]: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto :check
if errorlevel 2 goto :prod
goto :dev

REM Environment check only.
:check
call :banner
call :env_check
call :read_env
echo   Backend port:       %BACKEND_PORT%
echo   Frontend port:      5173
echo   Backend language:   %APP_LANG% ^(console output^)
echo   Health endpoint:    %C_CYAN%http://127.0.0.1:%BACKEND_PORT%/api/health%C_RESET%
echo.
if not defined OC_URL call :ensure_opencode_cli
if not defined OC_URL echo %ICON_OK%%C_RESET%  OpenCode CLI        %OPENCODE_CLI_V%
if not defined OC_URL echo.
call :footer
pause
exit /b 0

REM ==========================================================================
REM  PRODUCTION MODE (single port APP_PORT, default 7171)
REM ==========================================================================
:prod
call :banner
title RemoteCode - Prod
echo %C_BOLD%  PRODUCTION MODE%C_RESET%
echo.

call :env_check
call :read_env
title RemoteCode - Prod :%BACKEND_PORT%
call :step_bar 1 3 Environment

REM Clean up obsolete firewall rules from previous setup (silent, best effort).
netsh advfirewall firewall delete rule name="PWA Backend 8787" >nul 2>&1
netsh advfirewall firewall delete rule name="PWA Backend 7171" >nul 2>&1

REM Ensure firewall rule for the prod port (needs Admin; failure stays silent).
netsh advfirewall firewall show rule name="PWA Prod %BACKEND_PORT%" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="PWA Prod %BACKEND_PORT%" dir=in action=allow protocol=TCP localport=%BACKEND_PORT% >nul 2>&1

if not defined OC_URL call :ensure_opencode_cli
if not defined OC_URL echo %ICON_OK%%C_RESET%  OpenCode CLI        %OPENCODE_CLI_V%
if not defined OC_URL echo.
call :port_check %BACKEND_PORT%
call :step_bar 2 3 "OpenCode CLI"

echo %ICON_GO%%C_RESET%  Building for production...
call npm run build
if errorlevel 1 (
  call :fatal "Build failed." "Fix the errors above and retry."
  exit /b 1
)
echo %ICON_OK%%C_RESET%  Build              done
call :step_bar 3 3 Build
echo.

echo %C_BOLD%%C_CYAN%  READY - PRODUCTION%C_RESET%
echo.
echo   Status     %ICON_RUN%%C_RESET%  RUNNING
echo   Mode       Production ^(single port - 5173 stays closed, this is normal^)
echo   URL        %C_CYAN%http://localhost:%BACKEND_PORT%%C_RESET%
echo.
call :footer
echo   Starting production server ^(Ctrl+C to stop^)...
echo   Opening %C_CYAN%http://localhost:%BACKEND_PORT%%C_RESET% in your browser once the server is up...
start "OpenCode browser wait" /min cmd /c ""%~f0" waitopen %BACKEND_PORT% - http://localhost:%BACKEND_PORT%"
call npm start --silent
echo.
echo   Server stopped.
call :footer
pause
exit /b %ERRORLEVEL%

REM ==========================================================================
REM  DEVELOPMENT MODE (Vite on 5173 + backend on APP_PORT)
REM ==========================================================================
:dev
call :banner
title RemoteCode - Dev
echo %C_BOLD%  DEVELOPMENT MODE%C_RESET%
echo.

call :env_check
call :read_env
call :step_bar 1 4 Environment

REM Firewall rules are best-effort here (needs Admin; failure stays silent).
netsh advfirewall firewall show rule name="PWA Dev 5173" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="PWA Dev 5173" dir=in action=allow protocol=TCP localport=5173 >nul 2>&1
netsh advfirewall firewall show rule name="PWA Prod %BACKEND_PORT%" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="PWA Prod %BACKEND_PORT%" dir=in action=allow protocol=TCP localport=%BACKEND_PORT% >nul 2>&1
echo %ICON_OK%%C_RESET%  Firewall rules     checked
echo.
call :step_bar 2 4 Network

if not defined OC_URL call :ensure_opencode_cli
if not defined OC_URL echo %ICON_OK%%C_RESET%  OpenCode CLI        %OPENCODE_CLI_V%
if not defined OC_URL echo.
call :step_bar 3 4 "OpenCode CLI"

call :port_check 5173
call :port_check %BACKEND_PORT%
echo %ICON_OK%%C_RESET%  Ports              5173 + %BACKEND_PORT% checked
echo.
call :step_bar 4 4 Ports

echo %C_BOLD%%C_CYAN%  READY - DEVELOPMENT%C_RESET%
echo.
echo   Status     %ICON_RUN%%C_RESET%  STARTING ^(live log below^)
echo   Frontend   %C_CYAN%http://localhost:5173%C_RESET%
echo   Backend    %C_CYAN%http://localhost:%BACKEND_PORT%%C_RESET%
echo.
call :footer
echo   Opening %C_CYAN%http://localhost:5173%C_RESET% in your browser once backend + frontend are up...
start "OpenCode browser wait" /min cmd /c ""%~f0" waitopen %BACKEND_PORT% 5173 http://localhost:5173"
echo   Starting backend + frontend ^(Ctrl+C to stop^)...
call npm run dev --silent
echo.
echo   Servers stopped.
call :footer
pause
exit /b %ERRORLEVEL%

REM ---------------------------------------------------------------------------
REM ensure_opencode_cli: install or upgrade the OpenCode CLI to v2.
REM v2 is required because the backend runs "opencode serve --service" and
REM v1 has no such flag (it exits with code 1 and no useful message).
REM The v1 CLI ships as the "opencode-ai" package and owns the same "opencode"
REM binary name, so npm refuses to overwrite it (EEXIST) until that old
REM package is removed first. On success it exports OPENCODE_CLI_V.
REM ---------------------------------------------------------------------------
:ensure_opencode_cli
setlocal EnableDelayedExpansion
set "OC_VERSION="
for /f "delims=" %%v in ('opencode --version 2^>^&1') do if not defined OC_VERSION set "OC_VERSION=%%v"
REM v2 prints "opencode v2.0.18" while v1 printed a bare "1.18.32" - strip the
REM prefixes instead of assuming one fixed format, or a good v2 looks broken.
set "OC_VERSION=!OC_VERSION:opencode v=!"
set "OC_VERSION=!OC_VERSION:OpenCode v=!"
set "OC_VERSION=!OC_VERSION:v=!"
if not defined OC_VERSION set "OC_VERSION=(not found)"
if "!OC_VERSION:~0,2!"=="2." goto :cli_ok
echo %ICON_GO%%C_RESET%  OpenCode CLI !OC_VERSION! found, but v2 is required - reinstalling...
call npm uninstall -g opencode-ai
call npm install -g @opencode/cli@latest
if errorlevel 1 (
  endlocal
  call :fatal "Failed to install the OpenCode CLI." "Run manually: npm uninstall -g opencode-ai and npm install -g @opencode/cli@latest"
  exit /b 1
)
REM Re-read the version after a reinstall so the reported value is accurate.
set "OC_VERSION="
for /f "delims=" %%v in ('opencode --version 2^>^&1') do if not defined OC_VERSION set "OC_VERSION=%%v"
set "OC_VERSION=!OC_VERSION:opencode v=!"
set "OC_VERSION=!OC_VERSION:OpenCode v=!"
set "OC_VERSION=!OC_VERSION:v=!"
:cli_ok
endlocal & set "OPENCODE_CLI_V=%OC_VERSION%" & goto :eof

REM ---------------------------------------------------------------------------
REM waitopen: background helper (runs in a minimized window) that polls until
REM the servers answer, then opens the browser. Usage:
REM   run.bat waitopen <backendPort> <frontendPort|-> <url>
REM "-" skips the frontend check (prod = backend only). Gives up after ~2 min
REM so a failed start never leaves an orphan polling loop behind.
REM ---------------------------------------------------------------------------
:waitopen
set "WO_BACKEND=%~2"
set "WO_FRONTEND=%~3"
set "WO_URL=%~4"
set /a "WO_TRIES=0"
:waitopen_loop
set /a "WO_TRIES+=1"
if %WO_TRIES% GTR 120 exit /b 0
curl --fail --silent --output nul --max-time 2 "http://127.0.0.1:%WO_BACKEND%/api/health" <nul >nul 2>&1
if errorlevel 1 (
  REM ping كمهلة ثانية واحدة: يعمل حتى مع stdin مُعاد توجيهه (timeout يفشل هناك)
  ping -n 2 127.0.0.1 >nul
  goto :waitopen_loop
)
if not "%WO_FRONTEND%"=="-" (
  curl --fail --silent --output nul --max-time 2 "http://127.0.0.1:%WO_FRONTEND%/" <nul >nul 2>&1
  if errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    goto :waitopen_loop
  )
)
start "" "%WO_URL%"
exit /b 0
