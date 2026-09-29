@echo off
setlocal EnableExtensions
REM ==========================================================================
REM  RemoteCode - Launcher (Windows)
REM  --------------------------------------------------------------------------
REM  Usage: build.bat         = Development mode (backend + Vite on 5173)
REM         build.bat prod    = Production mode (build + single port APP_PORT)
REM         build.bat menu    = Interactive mode selection
REM         build.bat check   = Environment check only, then exit
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

REM Detail-line decoration for screens with no step tree (:check keeps its
REM own √-prefixed look): TP = tree spine prefix, TI = leading item icon,
REM TM = trailing item marker. :steps_begin re-points all three, so every
REM :env_check echo can stay one line for both layouts.
REM MARK_COL is the single column where EVERY status marker starts, so the
REM [√] rows, the one-line steps and the closing Done/Failed all line up.
REM ROW_TEXT is the visible width of a padded detail row (TP 5 + label 19 +
REM value 19), which is what the marker padding is measured against.
set "TP="
set "TI=%ICON_OK%%C_RESET%  "
set "TM="
REM MARK_COL must be >= the widest step_now line (dev Step 2/Step 4 are 68
REM visible chars + the 2-space gap = 70). If it is any smaller, that line's
REM padding clamps to zero and its marker lands past the column instead of on
REM it, which is exactly the ragged edge this constant exists to prevent.
set "MARK_COL=70"
set "ROW_TEXT=43"
REM Width of the longest step name ("Ensure OpenCode CLI" = 19) plus one
REM space, so every "->" in a one-line step starts in the same place.
set "ST_NAMECOL=20"

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
REM Inside a step tree the header hangs off the spine ("|--- TITLE ---")
REM so it reads as part of that step; check mode keeps the plain header.
:section
setlocal EnableDelayedExpansion
if not defined TP (
  echo %C_BLUE%  --- %~1 ---%C_RESET%
  echo.
  endlocal & goto :eof
)
echo %C_DIM%  ^|---%C_RESET%%C_BLUE% %~1 ---%C_RESET%
echo %C_DIM%  ^|%C_RESET%
endlocal & goto :eof

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

REM Vertical step tree (append-only history: no cls, no cursor moves,
REM no percentages, no fake delays). Steps print progressively - each one
REM keeps its final status in the scrollback, so nothing is ever redrawn.
REM Caller sets STEP_NAME_1..N, then:
REM   call :steps_begin "Title"  - title line; steps print below it as they start
REM   call :step_start <i>       - branch + ● Step <i> - <name>
REM   call :step_info "text"     - detail line under the running step
REM   call :step_done <i>        - standalone [√] Done line (multi-line steps)
REM   call :step_end            - "  [√] Done" suffix closing a set /p detail
REM                              line, so single-detail steps read
REM                              "|  <info>  [√] Done" on one line
REM   call :step_fail <i>        - [x] result line (caller adds :fatal + exit /b 1)
REM Step names and info text must avoid % and ! chars.
REM Step icons are ● running, [√] done, [x] failed, and the tree uses
REM ASCII branches (|-- |). ● is reused from ICON_RUN - the same glyph the
REM READY panels already print - so it renders wherever the rest of this
REM launcher does.
REM Title + spine opener so the first branch connects to the tree.
REM It also switches the detail decoration: TI empties the leading item icon
REM and TM adds a trailing [√], so status reads at the end of the line.
:steps_begin
echo %C_BOLD%  %~1%C_RESET%
echo %C_DIM%  ^|%C_RESET%
set "TP=%C_DIM%  |%C_RESET%  "
set "TI="
call :tree_marker
goto :eof

REM Builds TM = padding + the green [√], padded so the marker lands at
REM MARK_COL. :row prints ROW_TEXT visible chars, then TM contributes its
REM own 2-space gap, so the pad needed is MARK_COL - ROW_TEXT - 2.
REM Deriving it keeps :row, :step_now and :mark_pad in one column.
REM The result is exported with %-expansion, not !: a !-value read on the
REM same line as endlocal expands after the scope is gone and comes back
REM as the literal "!<name>!".
:tree_marker
setlocal EnableDelayedExpansion
set /a "TM_GAP=MARK_COL - ROW_TEXT - 2"
call :pad " " !TM_GAP! TM_S
set "TMV=!TM_S!  %C_GREEN%[√]%C_RESET%"
endlocal & set "TM=%TMV%" & goto :eof

REM Bare spine connector between step blocks. It replaces the blank echo.
REM lines there used to sit, so the branches stay joined in one tree.
REM Outside a tree there is no spine, so it degrades to a plain blank line
REM - which also resets errorlevel exactly like echo. did, leaving the
REM surrounding errorlevel checks unaffected.
:spine
setlocal EnableDelayedExpansion
if not defined TP goto :sp_blank
echo %C_DIM%  ^|%C_RESET%
endlocal & goto :eof
:sp_blank
echo.
endlocal & goto :eof

REM Announce step <i> as running. Every step uses the same |-- branch,
REM so the spine stays connected from the title to the last Done.
:step_start
setlocal EnableDelayedExpansion
echo %C_DIM%  ^|--%C_RESET% %C_CYAN%%ICON_RUN%%C_RESET% Step %~1 - !STEP_NAME_%~1!
endlocal
goto :eof

REM Announce step <i> with its result inline and finish it in one call:
REM   call :step_now <i> "<detail>"
REM Steps whose only outcome is a single fact (ports, CLI version) use this
REM instead of :step_start + a detail row, so no empty tree branch is left
REM hanging under the step. The line is padded to the marker column and the
REM closing [√] Done is appended, matching :rowj + :step_end.
:step_now
REM Two columns, both measured with :strlen rather than hand-counted:
REM   ST_NAMECOL - width of the step-name field, so every "->" lines up
REM   MARK_COL   - where [√] Done starts, so every marker lines up
REM The width reference uses a plain "x" for the ● glyph: :strlen counts
REM characters, and ● is multi-byte, so its width has to be faked as one.
setlocal EnableDelayedExpansion
call :strlen "!STEP_NAME_%~1!" ST_NL
set /a "ST_NGAP=!ST_NAMECOL! - !ST_NL!"
if !ST_NGAP! lss 1 set "ST_NGAP=0"
call :pad " " !ST_NGAP! ST_NP
REM The reference must mirror the visible line EXACTLY, padded name
REM included - measuring the bare name under-counts and pushes the marker
REM right by the padding width.
call :strlen "  |-- x Step %~1 - !STEP_NAME_%~1!!ST_NP!-> [%~2]" ST_W
REM The 2 subtracted is the gap the echo adds before [√] Done, same
REM correction :tree_marker makes for :row.
set /a "ST_GAP=!MARK_COL! - !ST_W! - 2"
if !ST_GAP! lss 1 set "ST_GAP=0"
call :pad " " !ST_GAP! ST_GP
echo %C_DIM%  ^|--%C_RESET% %C_CYAN%%ICON_RUN%%C_RESET% Step %~1 - !STEP_NAME_%~1!!ST_NP!-^> %C_BLUE%[%~2]%C_RESET%!ST_GP!  %C_GREEN%[√]%C_RESET% Done
endlocal & goto :eof

REM Detail line under the running step: call :step_info "text"
:step_info
echo %C_DIM%  ^|%C_RESET%    %~1
goto :eof

REM Close step <i> as done with a standalone line (multi-line steps only;
REM single-detail steps merge it via set /p + :step_end instead).
REM The marker is indented with :pad so it lands in the same column as the
REM one :step_end prints - see :mark_pad for the column arithmetic.
:step_done
call :mark_pad
echo %C_DIM%  ^|%C_RESET%  %MARK%  %C_GREEN%[√]%C_RESET% Done
goto :eof

REM Suffix closing a detail line printed without newline via set /p:
REM <nul set /p "=...detail..." + call :step_end yields one joined line.
REM :rowj already padded the value to the marker column, so the suffix
REM needs no extra indent - just the closing words.
REM Note: the pipe needs NO caret escape inside set /p - that text is taken
REM literally, so "^|" would print the caret itself.
:step_end
echo   %C_GREEN%[√]%C_RESET% Done
goto :eof

REM Close step <i> as failed. Caller must follow with :fatal + exit /b 1.
REM Shares the marker column with :step_done so the two never interleave.
:step_fail
call :mark_pad
echo %C_DIM%  ^|%C_RESET%  %MARK%  %C_RED%[x]%C_RESET% Failed
goto :eof

REM Exports MARK = the run of spaces that puts a status marker at MARK_COL,
REM the same column :row and :step_now use. Derived from MARK_COL rather
REM than hardcoded, so all three kinds of marker stay in one column:
REM   own prefix "  |  " (5) + MARK + gap "  " (2) = MARK_COL -> 62.
:mark_pad
REM Seeded with a real space, not "": an empty first argument makes the
REM length test in :pad misfire, so it would return nothing at all.
set /a "MARK_GAP=MARK_COL - 7"
call :pad " " %MARK_GAP% MARK
goto :eof

REM Exports %~2 = visible length of %~1. Used to pad a line out to the
REM marker column, so the column math never has to be done by hand.
REM The string must be free of ! and the loop counts characters, not bytes.
:strlen
setlocal EnableDelayedExpansion
set "SL_S=%~1"
set /a "SL_N=0"
:strlen_loop
if not "!SL_S:~%SL_N%!"=="" goto :strlen_more
endlocal & set "%~2=%SL_N%" & goto :eof
:strlen_more
set /a "SL_N+=1"
goto :strlen_loop

REM Right-pad %~1 with spaces up to %~2 chars and export as %~3.
REM Detail values differ in length (Node v24.21.0 vs npm 11.12.1), so
REM padding is what keeps every [√] marker in one vertical column.
REM Longer input is left untouched - padding never truncates data.
:pad
setlocal EnableDelayedExpansion
set "PD=%~1"
REM Skip padding when the value is already at or past the target width, so
REM the trim below can never cut real characters off the end.
if not "!PD:~%~2!"=="" goto :pd_keep
for /L %%k in (1,1,%~2) do set "PD=!PD! "
set "PD=!PD:~0,%~2!"
:pd_keep
endlocal & set "%~3=%PD%" & goto :eof

REM One aligned detail line: call :row "<label>" "<value>".
REM Label literals already carry the fixed column width, so only the value
REM gets padded. Without a tree (check mode) TM is empty and the row is
REM printed unpadded with its leading icon, exactly as before.
:row
setlocal EnableDelayedExpansion
if not defined TM (
  echo !TP!!TI!%~1%~2
  endlocal & goto :eof
)
call :pad "%~2" 19 PDV
echo !TP!!TI!%~1!PDV!!TM!
endlocal & goto :eof

REM Same as :row but leaves the line open (no newline) so :step_end can
REM append the "  [√] Done" suffix on that same line.
:rowj
setlocal EnableDelayedExpansion
call :pad "%~2" 19 PDV
<nul set /p "=!TP!!TI!%~1!PDV!"
endlocal & goto :eof

REM ==========================================================================
REM  ENVIRONMENT CHECK (every check is real - nothing is faked)
REM ==========================================================================
:env_check
REM Delayed scope so the !TP! spine prefix (set by :steps_begin, empty in
REM check mode) expands safely: pipes from !-expansion are never parsed
REM as operators, unlike %-expansion. NODE_V/NPM_V are display-only here.
setlocal EnableDelayedExpansion
call :section "SYSTEM CHECK"
where node >nul 2>&1
if errorlevel 1 (
  call :fatal "Node.js was not found in PATH." "Install Node.js 20 or newer, then retry."
  exit /b 1
)
set "NODE_V="
for /f "delims=" %%v in ('node --version 2^>nul') do if not defined NODE_V set "NODE_V=%%v"
call :row "Node.js            " "%NODE_V%"

where npm >nul 2>&1
if errorlevel 1 (
  call :fatal "npm was not found in PATH." "Install Node.js 20 or newer, then retry."
  exit /b 1
)
set "NPM_V="
for /f "delims=" %%v in ('call npm --version 2^>nul') do if not defined NPM_V set "NPM_V=%%v"
call :row "npm                " "%NPM_V%"

if not exist "package.json" (
  call :fatal "package.json not found." "Run this launcher from the project folder."
  exit /b 1
)
if not exist "server\index.ts" (
  call :fatal "server\index.ts not found." "Run this launcher from the project folder."
  exit /b 1
)
call :row "Project            " "found"

if exist "node_modules" (
  call :row "Dependencies       " "ready"
) else (
  call :row "Dependencies       " "installing..."
  call npm install
  if errorlevel 1 (
    call :fatal "npm install failed." "Fix the errors above and retry."
    exit /b 1
  )
  call :row "Dependencies       " "installed"
)

if exist ".env" (
  call :row "Configuration      " ".env found"
) else (
  call :row "Configuration      " "creating .env..."
  call npm run setup
  if errorlevel 1 (
    call :fatal "npm run setup failed." "Fix the errors above and retry."
    exit /b 1
  )
  call :row "Configuration      " ".env created"
)
REM :spine prints the blank line here when no tree is active, so the
REM step block still gets its original breathing room in check mode.
call :spine
endlocal & goto :eof

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
REM  INTERACTIVE MENU (additive - plain "build.bat" still starts Dev directly)
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

REM Vertical steps mirror the commands below in the same order:
REM 1 = :env_check, 2 = firewall + port check,
REM 3 = :ensure_opencode_cli, 4 = npm run build.
set "STEP_NAME_1=Check environment"
set "STEP_NAME_2=Configure network"
set "STEP_NAME_3=Ensure OpenCode CLI"
set "STEP_NAME_4=Build for production"
call :steps_begin "Build Project"

call :step_start 1
call :env_check
REM No :step_done here - every check row already carries its own [√], so a
REM closing Done line would only repeat the status in a column of its own.
if errorlevel 1 call :step_fail 1
call :read_env
title RemoteCode - Prod :%BACKEND_PORT%
call :spine

REM No :step_start here - :step_now announces step 2 itself, and printing
REM both would show the same branch twice.
REM Clean up obsolete firewall rules from previous setup (silent, best effort).
netsh advfirewall firewall delete rule name="PWA Backend 8787" >nul 2>&1
netsh advfirewall firewall delete rule name="PWA Backend 7171" >nul 2>&1

REM Ensure firewall rule for the prod port (needs Admin; failure stays silent).
netsh advfirewall firewall show rule name="PWA Prod %BACKEND_PORT%" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="PWA Prod %BACKEND_PORT%" dir=in action=allow protocol=TCP localport=%BACKEND_PORT% >nul 2>&1

call :port_check %BACKEND_PORT%
call :step_now 2 "Firewall rules     checked"
call :spine

REM Decide the outcome before printing anything: the check is fast, and a
REM branch printed up front would either be duplicated by :step_now or
REM leave a dangling Done/Failed line with no step above it.
set "OC_FAIL="
if not defined OC_URL call :ensure_opencode_cli
if errorlevel 1 set "OC_FAIL=1"
if defined OC_FAIL (
  call :step_start 3
  call :step_fail 3
) else if defined OC_URL (
  call :step_start 3
  call :step_done 3
) else (
  call :step_now 3 "OpenCode CLI %OPENCODE_CLI_V%"
)
call :spine

call :step_start 4
call :step_info "typecheck + Vite frontend + server compile"
echo %C_DIM%  ^|%C_RESET%    %C_CYAN%^>^>%C_RESET%  Building for production...
call npm run build
if errorlevel 1 (
  call :step_fail 4
  call :fatal "Build failed." "Fix the errors above and retry."
  exit /b 1
)
echo %C_DIM%  ^|%C_RESET%    %ICON_OK%%C_RESET%  Build              done
call :step_done 4
call :spine

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

REM Same step shape as prod, but the last stage checks ports instead of
REM building: 1 = :env_check, 2 = firewall rules,
REM 3 = :ensure_opencode_cli, 4 = :port_check x2.
set "STEP_NAME_1=Check environment"
set "STEP_NAME_2=Configure network"
set "STEP_NAME_3=Ensure OpenCode CLI"
set "STEP_NAME_4=Check ports"
call :steps_begin "Start Project"

call :step_start 1
call :env_check
REM No :step_done here - every check row already carries its own [√].
if errorlevel 1 call :step_fail 1
call :read_env
call :spine

REM No :step_start here either - :step_now announces step 2 itself.
REM Firewall rules are best-effort here (needs Admin; failure stays silent).
netsh advfirewall firewall show rule name="PWA Dev 5173" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="PWA Dev 5173" dir=in action=allow protocol=TCP localport=5173 >nul 2>&1
netsh advfirewall firewall show rule name="PWA Prod %BACKEND_PORT%" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="PWA Prod %BACKEND_PORT%" dir=in action=allow protocol=TCP localport=%BACKEND_PORT% >nul 2>&1
call :step_now 2 "Firewall rules     checked"
call :spine

REM Same decide-then-print rule as prod: exactly one branch, never two.
set "OC_FAIL="
if not defined OC_URL call :ensure_opencode_cli
if errorlevel 1 set "OC_FAIL=1"
if defined OC_FAIL (
  call :step_start 3
  call :step_fail 3
) else if defined OC_URL (
  call :step_start 3
  call :step_done 3
) else (
  call :step_now 3 "OpenCode CLI %OPENCODE_CLI_V%"
)
call :spine

call :port_check 5173
call :port_check %BACKEND_PORT%
call :step_now 4 "Ports  5173 + %BACKEND_PORT% checked"

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
REM   build.bat waitopen <backendPort> <frontendPort|-> <url>
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
