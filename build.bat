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

REM Brand cyan (36) frames the wordmark and the panels; the brighter 96 cyan is
REM reserved for values and URLs, so the eye lands on the information first.
set "C_BRAND=%ESC%[36m"
set "C_WHITE=%ESC%[97m"

set "ICON_OK=%C_GREEN%✓"
set "ICON_RUN=%C_CYAN%●"
set "ICON_GO=%C_CYAN%→"
set "ICON_WARN=%C_YELLOW%!"
set "ICON_ERR=%C_RED%×"

REM Detail-line decoration for screens with no step tree (:check keeps its
REM own √-prefixed look): TP = tree spine prefix, TI = leading item icon,
REM TM = trailing item marker. :steps_begin re-points all three, so every
REM :env_check echo can stay one line for both layouts.
REM MARK_COL is the single column where EVERY status marker starts, so the
REM ✓ rows, the one-line steps and the closing Done/Failed all line up.
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
REM Wordmark in a fixed block font so it renders the same in Windows Terminal,
REM VS Code and a plain console. The version below is read from package.json
REM (:read_version) and drawn by :header, never hardcoded.
echo %C_BRAND%%C_BOLD%   ████   █████  █   █   ███   █████  █████          ████   ███   ████   █████
echo    █   █  █      ██ ██  █   █    █    █             █      █   █  █   █  █
echo    ████   ████   █ █ █  █   █    █    ████   █████  █      █   █  █   █  ████
echo    █  █   █      █   █  █   █    █    █             █      █   █  █   █  █
echo    █   █  █████  █   █   ███     █    █████          ████   ███   ████   █████%C_RESET%
echo.
call :read_version
call :header
echo   %C_GRAY%REMOTE DEVELOPMENT PLATFORM%C_RESET%  %C_DIM%·%C_RESET%  %C_GRAY%Windows Launcher%C_RESET%
echo.
goto :eof

REM Read the project version out of package.json without Node, because the
REM banner prints before :env_check and must still render on a machine whose
REM toolchain is not working yet. Falls back to "v?" when the file is missing;
REM :env_check reports that as a fatal error right after.
:read_version
set "APP_VERSION="
for /f "usebackq tokens=2 delims=:" %%v in (`findstr /r /c:"^  .version." "package.json" 2^>nul`) do if not defined APP_VERSION call :clean_version "%%v"
if not defined APP_VERSION set "APP_VERSION=v?"
goto :eof

REM The raw value is "1.8.0", - strip the spaces, quotes and trailing comma,
REM then add the leading v the UI uses. Exported with %-expansion, not !: a
REM !-value read on the endlocal line expands after the scope is gone and
REM comes back as the literal "!<name>" text.
:clean_version
setlocal EnableDelayedExpansion
set "CV=%~1"
set "CV=!CV: =!"
set "CV=!CV:"=!"
set "CV=!CV:,=!"
endlocal & set "APP_VERSION=v%CV%" & goto :eof

REM ---------------------------------------------------------------------------
REM Shared presentation pieces. They read only APP_VERSION and the color vars -
REM no functional routine depends on them and none of them touch state.
REM ---------------------------------------------------------------------------
REM :dash <count> <out> - build a run of <count> box-drawing dashes. Built by a
REM loop rather than a literal so the width can never drift from the caller.
:dash
setlocal EnableDelayedExpansion
set "DH="
for /L %%k in (1,1,%~1) do set "DH=!DH!─"
endlocal & set "%~2=%DH%" & goto :eof

REM :header - the RemoteCode identity panel. APP_VERSION is right-aligned, so
REM the right edge stays fixed whatever the number's length.
:header
setlocal EnableDelayedExpansion
call :strlen "%APP_VERSION%" HD_VL
set /a "HD_VG=46 - HD_VL"
if !HD_VG! lss 1 set "HD_VG=1"
call :pad " " !HD_VG! HD_VS
call :strlen "Remote development, reimagined." HD_TL
set /a "HD_TG=60 - 2 - HD_TL"
if !HD_TG! lss 1 set "HD_TG=1"
call :pad " " !HD_TG! HD_TS
call :dash 60 HD_RULE
echo %C_BRAND%  ╭%HD_RULE%╮%C_RESET%
echo %C_BRAND%  │%C_RESET%  %C_BOLD%%C_WHITE%REMOTECODE%C_RESET%!HD_VS!%C_CYAN%%APP_VERSION%%C_RESET%  %C_BRAND%│%C_RESET%
echo %C_BRAND%  │%C_RESET%  %C_GRAY%Remote development, reimagined.%C_RESET%!HD_TS!%C_BRAND%│%C_RESET%
echo %C_BRAND%  ╰%HD_RULE%╯%C_RESET%
endlocal & goto :eof

REM :center <text> - one centred, bordered line inside the 60-wide identity box.
:center
setlocal EnableDelayedExpansion
call :strlen "%~1" CT_L
set /a "CT_LG=(60 - CT_L)/2"
if !CT_LG! lss 0 set "CT_LG=0"
set /a "CT_RG=60 - CT_L - CT_LG"
if !CT_RG! lss 0 set "CT_RG=0"
call :pad " " !CT_LG! CT_LP
call :pad " " !CT_RG! CT_RP
echo %C_BRAND%  │%C_RESET%!CT_LP!%C_BOLD%%C_WHITE%%~1%C_RESET%!CT_RP!%C_BRAND%│%C_RESET%
endlocal & goto :eof

REM :ready_box <title> <mode> - the payoff panel shown once a mode is up.
:ready_box
setlocal EnableDelayedExpansion
call :dash 60 RB_RULE
echo %C_BRAND%  ╭%RB_RULE%╮%C_RESET%
call :center "%~1"
call :center "%~2"
echo %C_BRAND%  ╰%RB_RULE%╯%C_RESET%
endlocal & goto :eof

REM Thin section header: call :section "TITLE"
REM Inside a step tree the header hangs off the spine so it reads as part of
REM that step; check mode draws the standalone top-corner variant.
:section
setlocal EnableDelayedExpansion
call :strlen "%~1" SEC_L
set /a "SEC_D=53 - SEC_L"
if !SEC_D! lss 1 set "SEC_D=1"
call :dash !SEC_D! SEC_RULE
if not defined TP (
  echo %C_BRAND%  ┌─%C_RESET% %C_BOLD%%C_BLUE%%~1%C_RESET% %C_DIM%!SEC_RULE!%C_RESET%
  echo.
  endlocal & goto :eof
)
echo %C_DIM%  │%C_RESET%  %C_BRAND%├─%C_RESET% %C_BOLD%%C_BLUE%%~1%C_RESET% %C_DIM%!SEC_RULE!%C_RESET%
endlocal & goto :eof

REM Footer shown under every major screen. Version is the live one from
REM package.json, so it can never advertise a number a release bump moved past.
:footer
setlocal EnableDelayedExpansion
call :dash 60 FT_RULE
echo %C_DIM%  %FT_RULE%%C_RESET%
echo %C_GRAY%   RemoteCode  %C_DIM%·%C_GRAY%  Remote development, reimagined.%C_RESET%
echo %C_GRAY%   %APP_VERSION%  %C_DIM%·%C_GRAY%  Windows Launcher%C_RESET%
echo.
endlocal & goto :eof

REM Warning panel (non-fatal): call :warn_box "message"
:warn_box
setlocal EnableDelayedExpansion
REM Size the panel to its message (clamped) so the top and bottom rules always
REM meet the text, whatever length the caller passes. Capped at 76 so the rule
REM itself never wraps in an 80-column console.
call :strlen "%~1" WB_ML
set /a "WB_W=WB_ML + 5"
if !WB_W! lss 50 set "WB_W=50"
if !WB_W! gtr 76 set "WB_W=76"
call :strlen "WARNING" WB_L
set /a "WB_D=WB_W - 6 - WB_L"
call :dash !WB_D! WB_RULE
set /a "WB_F=WB_W - 4"
call :dash !WB_F! WB_FLOOR
echo %C_YELLOW%  ┌─%C_RESET% %C_BOLD%%C_YELLOW%WARNING%C_RESET% %C_YELLOW%!WB_RULE!%C_RESET%
echo %C_YELLOW%  │%C_RESET%  %~1
echo %C_YELLOW%  └%C_RESET% %C_YELLOW%!WB_FLOOR!%C_RESET%
echo.
endlocal & goto :eof

REM Fatal error: prints a panel and pauses. It returns to the caller with
REM errorlevel 1, so every caller must follow it with "exit /b 1".
:fatal
setlocal EnableDelayedExpansion
REM Panel width follows the longest line (message or hint), clamped like
REM :warn_box so the rules always meet the text and never wrap.
call :strlen "%~1" FT_ML
set /a "FT_W=FT_ML + 5"
if not "%~2"=="" (
  call :strlen "%~2" FT_HL
  set /a "FT_HW=FT_HL + 5"
  if !FT_HW! gtr !FT_W! set "FT_W=!FT_HW!"
)
if !FT_W! lss 50 set "FT_W=50"
if !FT_W! gtr 76 set "FT_W=76"
call :strlen "REMOTECODE ERROR" FT_L
set /a "FT_D=FT_W - 6 - FT_L"
call :dash !FT_D! FT_RULE
set /a "FT_F=FT_W - 4"
call :dash !FT_F! FT_FLOOR
echo %C_RED%  ┌─%C_RESET% %C_BOLD%%C_RED%REMOTECODE ERROR%C_RESET% %C_RED%!FT_RULE!%C_RESET%
echo %C_RED%  │%C_RESET%  %C_WHITE%%~1%C_RESET%
if not "%~2"=="" echo %C_RED%  │%C_RESET%  %C_GRAY%%~2%C_RESET%
echo %C_RED%  └%C_RESET% %C_RED%!FT_FLOOR!%C_RESET%
echo.
echo   %C_GRAY%The technical output above is preserved for troubleshooting.%C_RESET%
echo.
pause
endlocal
exit /b 1

REM Vertical step tree (append-only history: no cls, no cursor moves,
REM no percentages, no fake delays). Steps print progressively - each one
REM keeps its final status in the scrollback, so nothing is ever redrawn.
REM Caller sets STEP_NAME_1..N, then:
REM   call :steps_begin "Title"  - title line; steps print below it as they start
REM   call :step_start <i>       - branch + ● Step <i> · <name>
REM   call :step_info "text"     - detail line under the running step
REM   call :step_done <i>        - standalone ✓ Done line (multi-line steps)
REM   call :step_end            - "  ✓ Done" suffix closing a set /p detail
REM                              line, so single-detail steps read
REM                              "│  <info>  ✓ Done" on one line
REM   call :step_fail <i>        - ✕ result line (caller adds :fatal + exit /b 1)
REM Step names and info text must avoid % and ! chars.
REM Step icons are ● running, ✓ done, ✕ failed, and the tree uses
REM box-drawing branches (├── │). ● is reused from ICON_RUN - the same glyph the
REM READY panels already print - so it renders wherever the rest of this
REM launcher does.
REM Title + spine opener so the first branch connects to the tree.
REM It also switches the detail decoration: TI empties the leading item icon
REM and TM adds a trailing ✓, so status reads at the end of the line.
:steps_begin
echo %C_BOLD%%C_BLUE%  %~1%C_RESET%
echo %C_DIM%  │%C_RESET%
set "TP=%C_DIM%  │%C_RESET%  "
set "TI="
call :tree_marker
goto :eof

REM Builds TM = padding + the green ✓, padded so the marker lands at
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
set "TMV=!TM_S!  %C_GREEN%✓%C_RESET%"
endlocal & set "TM=%TMV%" & goto :eof

REM Bare spine connector between step blocks. It replaces the blank echo.
REM lines there used to sit, so the branches stay joined in one tree.
REM Outside a tree there is no spine, so it degrades to a plain blank line
REM - which also resets errorlevel exactly like echo. did, leaving the
REM surrounding errorlevel checks unaffected.
:spine
setlocal EnableDelayedExpansion
if not defined TP goto :sp_blank
echo %C_DIM%  │%C_RESET%
endlocal & goto :eof
:sp_blank
echo.
endlocal & goto :eof

REM Announce step <i> as running. Every step uses the same ├── branch,
REM so the spine stays connected from the title to the last Done.
:step_start
setlocal EnableDelayedExpansion
echo %C_DIM%  ├──%C_RESET% %ICON_RUN%%C_RESET% %C_BOLD%Step %~1%C_RESET% %C_DIM%·%C_RESET% !STEP_NAME_%~1!
endlocal
goto :eof

REM Announce step <i> with its result inline and finish it in one call:
REM   call :step_now <i> "<detail>"
REM Steps whose only outcome is a single fact (ports, CLI version) use this
REM instead of :step_start + a detail row, so no empty tree branch is left
REM hanging under the step. The line is padded to the marker column and the
REM closing ✓ Done is appended, matching :rowj + :step_end.
:step_now
REM Two columns, both measured with :strlen rather than hand-counted:
REM   ST_NAMECOL - width of the step-name field, so every "->" lines up
REM   MARK_COL   - where ✓ Done starts, so every marker lines up
REM The width reference uses a plain "x" for the ● glyph: :strlen counts
REM characters, and ● is multi-byte, so its width has to be faked as one.
setlocal EnableDelayedExpansion
call :strlen "!STEP_NAME_%~1!" ST_NL
set /a "ST_NGAP=!ST_NAMECOL! - !ST_NL!"
REM :pad seeds on a real space, so a 0 target still yields one space. The guard
REM keeps a zero-width field truly empty so the marker column stays exact.
set "ST_NP="
if !ST_NGAP! gtr 0 call :pad " " !ST_NGAP! ST_NP
REM The reference must mirror the visible line EXACTLY, padded name
REM included - measuring the bare name under-counts and pushes the marker
REM right by the padding width.
call :strlen "  ├── x Step %~1 · !STEP_NAME_%~1!!ST_NP!-> [%~2]" ST_W
REM The 2 subtracted is the gap the echo adds before ✓ Done, same
REM correction :tree_marker makes for :row.
set /a "ST_GAP=!MARK_COL! - !ST_W! - 2"
set "ST_GP="
if !ST_GAP! gtr 0 call :pad " " !ST_GAP! ST_GP
echo %C_DIM%  ├──%C_RESET% %ICON_RUN%%C_RESET% %C_BOLD%Step %~1%C_RESET% %C_DIM%·%C_RESET% !STEP_NAME_%~1!!ST_NP!-^> %C_BLUE%[%~2]%C_RESET%!ST_GP!  %C_GREEN%✓%C_RESET% Done
endlocal & goto :eof

REM Detail line under the running step: call :step_info "text"
:step_info
echo %C_DIM%  │%C_RESET%    %~1
goto :eof

REM Close step <i> as done with a standalone line (multi-line steps only;
REM single-detail steps merge it via set /p + :step_end instead).
REM The marker is indented with :pad so it lands in the same column as the
REM one :step_end prints - see :mark_pad for the column arithmetic.
:step_done
call :mark_pad
echo %C_DIM%  │%C_RESET%  %MARK%  %C_GREEN%✓%C_RESET% Done
goto :eof

REM Suffix closing a detail line printed without newline via set /p:
REM <nul set /p "=...detail..." + call :step_end yields one joined line.
REM :rowj already padded the value to the marker column, so the suffix
REM needs no extra indent - just the closing words.
REM Note: the pipe needs NO caret escape inside set /p - that text is taken
REM literally, so "^|" would print the caret itself.
:step_end
echo   %C_GREEN%✓%C_RESET% Done
goto :eof

REM Close step <i> as failed. Caller must follow with :fatal + exit /b 1.
REM Shares the marker column with :step_done so the two never interleave.
:step_fail
call :mark_pad
echo %C_DIM%  │%C_RESET%  %MARK%  %C_RED%✕%C_RESET% Failed
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
REM padding is what keeps every ✓ marker in one vertical column.
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
REM append the "  ✓ Done" suffix on that same line.
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

REM Restore the TLS paths that npm run setup leaves empty. setup writes
REM APP_TLS_CERT_PATH= and APP_TLS_KEY_PATH= as empty defaults and its
REM "if (!values.get(key))" guard treats an empty string as already set, so
REM it never backfills them. Without this, deleting .env silently drops TLS
REM and the phone loses the microphone (it needs a trusted HTTPS origin).
REM
REM Order matters: ensure_cert generates cert\server.pem + server-key.pem
REM when they are missing (and trusts the CA so the phone browser accepts
REM the origin), then ensure_tls points .env at them.
call :ensure_cert
call :ensure_tls

REM :spine prints the blank line here when no tree is active, so the
REM step block still gets its original breathing room in check mode.
call :spine
REM Hand CA_EXPORT and CERT_STATE to the caller: this block runs under
REM setlocal, so without an explicit export the check screen (which reads
REM them after :env_check returns) would always see them empty.
endlocal & set "CA_EXPORT=%CA_EXPORT%" & set "CERT_STATE=%CERT_STATE%" & set "TLS_STATE=%TLS_STATE%" & goto :eof

REM ---------------------------------------------------------------------------
REM ensure_cert: generate a locally-trusted TLS certificate when cert\ is empty,
REM and renew it when the LAN IP it covers changed.
REM
REM Why this exists: the phone microphone (Web Speech API) and Web Push only
REM work on a secure origin, and Chrome does NOT treat an untrusted cert as
REM secure - the CA has to be in the machine's Root store. So the routine
REM covers the whole chain, not just the files:
REM   1. install mkcert via winget when it is missing
REM   2. mkcert -install   -> trust the CA in the Windows Root store
REM   3. mkcert ... localhost 127.0.0.1 <LAN_IP> <Alt IPs>  -> matching SAN
REM   4. copy the CA out to cert\rootCA.crt so the phone can install it too
REM
REM The SAN must carry the LAN IP. The phone opens https://<LAN_IP>:<port>,
REM and a cert without that exact IP is rejected, whatever the Root store says.
REM So LAN_IP is re-probed here if :show_ip has not run yet, and a pair whose
REM SAN no longer covers the printed IP is rebuilt - without that, fixing the
REM IP in the launcher would still leave the phone on a certificate error.
REM The Alt IPs go into the SAN as well, so moving between the listed networks
REM does not trigger a renewal. The check itself is scripts\cert-san.mjs: it
REM reports 0 covered / 1 missing / 2 unreadable, and only 1 renews.
REM
REM Everything is best-effort: a failure leaves TLS off (the plain-http path
REM keeps working) instead of aborting the launch. Renewal writes .new files
REM first and only replaces the pair after mkcert succeeded, so a failed run
REM never destroys a certificate that is still on disk.
REM Exports CERT_STATE for the caller to display.
REM ---------------------------------------------------------------------------
:ensure_cert
set "CERT_STATE="
set "CA_HINT="
set "CERT_RENEW="
REM Always resolve the CA location, even when the pair is already present, so
REM the launcher can show the phone where to get the certificate every run.
call :resolve_mkcert
call :export_ca
if not exist "cert\server.pem" goto :cert_build
if not exist "cert\server-key.pem" goto :cert_build
REM The pair exists: keep it while its SAN still covers the LAN IP, and also
REM when the check itself fails (result 2) - a pair we cannot read is still
REM better than no pair at all. A renewal additionally needs mkcert, because
REM without it there is nothing to rebuild the files with.
if not defined LAN_IP call :lan_ip
if not defined LAN_IP set "CERT_STATE=present" & goto :eof
node "scripts\cert-san.mjs" "cert\server.pem" "%LAN_IP%" >nul 2>&1
if not "%ERRORLEVEL%"=="1" set "CERT_STATE=present" & goto :eof
if not defined MKCERT_BIN set "CERT_STATE=present" & goto :eof
set "CERT_RENEW=1"

:cert_build
REM The CA row needs the LAN IP for the SAN; :lan_ip exports LAN_IP.
if not defined LAN_IP call :lan_ip

REM Resolve the binary: PATH first, then the winget package folder. winget
REM does NOT create a Links shim for FiloSottile.mkcert - the .exe lands
REM directly in Packages\<id>\ - so a PATH-only lookup would report "missing"
REM right after a successful install.
if not defined MKCERT_BIN call :install_mkcert
if not defined MKCERT_BIN call :resolve_mkcert
if not defined MKCERT_BIN set "CERT_STATE=no-mkcert" & goto :eof

if not exist "cert" mkdir "cert" >nul 2>&1

REM mkcert -install needs write access to the Root store. Run in the current
REM user's store first (no admin prompt); if it cannot, the caller still gets
REM the files and the browser just shows the usual one-time warning.
call "%MKCERT_BIN%" -install >nul 2>&1

set "CERT_SANS=localhost 127.0.0.1"
if defined LAN_IP set "CERT_SANS=localhost 127.0.0.1 %LAN_IP%"
if defined LAN_IP_ALT1 set "CERT_SANS=%CERT_SANS% %LAN_IP_ALT1%"
if defined LAN_IP_ALT2 set "CERT_SANS=%CERT_SANS% %LAN_IP_ALT2%"
REM Push the switch-command directory too: mkcert resolves -cert-file /
REM -key-file relative to the shell's current directory, and cmd keeps its
REM own per-drive cwd, so a clean "%CD%" makes the output land in cert\.
REM Output goes to .new files first: the live pair is replaced only after both
REM files exist, so a failed mkcert run leaves the previous pair untouched.
pushd "%~dp0"
call "%MKCERT_BIN%" -key-file "cert\server-key.new.pem" -cert-file "cert\server.new.pem" %CERT_SANS% >nul 2>&1
set "CERT_RC=%ERRORLEVEL%"
popd
if not "%CERT_RC%"=="0" goto :cert_build_failed
if not exist "cert\server.new.pem" goto :cert_build_failed
if not exist "cert\server-key.new.pem" goto :cert_build_failed
move /y "cert\server.new.pem" "cert\server.pem" >nul 2>&1
if errorlevel 1 goto :cert_build_failed
move /y "cert\server-key.new.pem" "cert\server-key.pem" >nul 2>&1
if errorlevel 1 goto :cert_build_failed

REM Hand the phone something to trust: mkcert keeps its root at CAROOT, and
REM the copied .crt is what gets installed on the device once per phone.
call :export_ca

if defined CERT_RENEW set "CERT_STATE=renewed" & goto :eof
set "CERT_STATE=created"
goto :eof

:cert_build_failed
del "cert\server.new.pem" "cert\server-key.new.pem" >nul 2>&1
REM A failed renewal keeps the previous pair on disk, so report it as present:
REM the phone can still be pointed at the address that pair covers.
if defined CERT_RENEW set "CERT_STATE=present" & goto :eof
set "CERT_STATE=generate-failed"
goto :eof

REM ---------------------------------------------------------------------------
REM resolve_ca_path: export CA_SOURCE (the CA mkcert actually trusts) and
REM CA_EXPORT (the copy inside the project). Prefers the project copy when it
REM exists, so the printed path is one the user can hand to a phone.
REM ---------------------------------------------------------------------------
:resolve_ca_path
set "CA_SOURCE="
set "CA_EXPORT="
if exist "cert\rootCA.crt" set "CA_EXPORT=%CD%\cert\rootCA.crt"
if defined MKCERT_BIN for /f "usebackq delims=" %%r in (`"%MKCERT_BIN%" -CAROOT 2^>nul`) do set "MKCERT_CAROOT=%%r"
if not defined MKCERT_CAROOT if exist "%LOCALAPPDATA%\mkcert\rootCA.pem" set "MKCERT_CAROOT=%LOCALAPPDATA%\mkcert"
if defined MKCERT_CAROOT if exist "%MKCERT_CAROOT%\rootCA.pem" set "CA_SOURCE=%MKCERT_CAROOT%\rootCA.pem"
goto :eof

REM ---------------------------------------------------------------------------
REM export_ca: refresh cert\rootCA.crt from the mkcert CAROOT so the project
REM always carries a current copy for the phone. Silent when the source is
REM missing - the launcher still runs, it just cannot offer the file.
REM ---------------------------------------------------------------------------
:export_ca
call :resolve_ca_path
if not defined CA_SOURCE goto :eof
if not exist "cert" mkdir "cert" >nul 2>&1
copy /y "%CA_SOURCE%" "cert\rootCA.crt" >nul 2>&1
set "CA_EXPORT=%CD%\cert\rootCA.crt"
goto :eof

REM ---------------------------------------------------------------------------
REM resolve_mkcert: export MKCERT_BIN = path to mkcert.exe, or leave it empty.
REM Checks PATH first (a manually installed copy), then the winget package
REM folder, whose exact directory name carries a source suffix we cannot
REM hardcode - so it is globbed with a plain wildcard.
REM ---------------------------------------------------------------------------
:resolve_mkcert
set "MKCERT_BIN="
for /f "delims=" %%m in ('where mkcert 2^>nul') do if not defined MKCERT_BIN set "MKCERT_BIN=%%m"
if defined MKCERT_BIN goto :eof
REM `for /d` instead of `dir /b /s`: dir rejects /s when the directory part
REM itself carries a wildcard, so the glob has to walk the folder names and
REM then test for the exe inside each match.
for /d %%d in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\FiloSottile.mkcert_*") do if exist "%%~fd\mkcert.exe" if not defined MKCERT_BIN set "MKCERT_BIN=%%~fd\mkcert.exe"
if defined MKCERT_BIN goto :eof
for /d %%d in ("%USERPROFILE%\scoop\apps\mkcert\*") do if exist "%%~fd\mkcert.exe" if not defined MKCERT_BIN set "MKCERT_BIN=%%~fd\mkcert.exe"
goto :eof

REM ---------------------------------------------------------------------------
REM install_mkcert: best-effort winget install of FiloSottile.mkcert.
REM The install lands in a per-user path that may not be on PATH yet, so the
REM common shim locations are probed before giving up. Failures are silent -
REM :ensure_cert reports the outcome.
REM ---------------------------------------------------------------------------
:install_mkcert
echo %C_DIM%  │%C_RESET%  mkcert not found - installing via winget...
where winget >nul 2>&1
if errorlevel 1 goto :eof
call winget install --id FiloSottile.mkcert --exact --accept-source-agreements --accept-package-agreements --silent >nul 2>&1
REM Refresh PATH from the registry so a just-installed shim is visible.
set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links;%USERPROFILE%\scoop\shims"
goto :eof

REM ---------------------------------------------------------------------------
REM ensure_tls: point .env at cert\server.pem + cert\server-key.pem whenever
REM both files exist and the .env values are still empty.
REM
REM Only the two TLS lines are rewritten (read-modify-write via a temp file),
REM so the access token and VAPID keys are never touched. External URLs and
REM any line this block does not understand are preserved verbatim.
REM A non-empty value is left alone on purpose: switching TLS off is a
REM deliberate choice, so the launcher must not re-enable it behind your back.
REM Exports TLS_STATE for the caller to display.
REM ---------------------------------------------------------------------------
:ensure_tls
set "TLS_STATE="
if not exist "cert\server.pem" set "TLS_STATE=no-cert" & goto :eof
if not exist "cert\server-key.pem" set "TLS_STATE=no-cert" & goto :eof
if not exist ".env" set "TLS_STATE=no-env" & goto :eof

set "TLS_CUR_CERT="
set "TLS_CUR_KEY="
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
  if "%%a"=="APP_TLS_CERT_PATH" set "TLS_CUR_CERT=%%b"
  if "%%a"=="APP_TLS_KEY_PATH" set "TLS_CUR_KEY=%%b"
)
if defined TLS_CUR_CERT if defined TLS_CUR_KEY set "TLS_STATE=already" & goto :eof

if exist ".env.remotecode-tmp" del ".env.remotecode-tmp" >nul 2>&1
set "TLS_WROTE_CERT="
set "TLS_WROTE_KEY="
for /f "usebackq delims=" %%l in (".env") do (
  set "TLS_LINE=%%l"
  setlocal EnableDelayedExpansion
  if "!TLS_LINE:~0,18!"=="APP_TLS_CERT_PATH=" (
    echo APP_TLS_CERT_PATH=cert/server.pem>>".env.remotecode-tmp"
    endlocal & set "TLS_WROTE_CERT=1"
  ) else if "!TLS_LINE:~0,17!"=="APP_TLS_KEY_PATH=" (
    echo APP_TLS_KEY_PATH=cert/server-key.pem>>".env.remotecode-tmp"
    endlocal & set "TLS_WROTE_KEY=1"
  ) else (
    endlocal
    echo %%l>>".env.remotecode-tmp"
  )
)
REM Append whichever key is missing from the file entirely (a hand-trimmed
REM .env may not carry the line at all).
if not defined TLS_WROTE_CERT echo APP_TLS_CERT_PATH=cert/server.pem>>".env.remotecode-tmp"
if not defined TLS_WROTE_KEY echo APP_TLS_KEY_PATH=cert/server-key.pem>>".env.remotecode-tmp"

move /y ".env.remotecode-tmp" ".env" >nul 2>&1
if errorlevel 1 (
  del ".env.remotecode-tmp" >nul 2>&1
  set "TLS_STATE=failed"
  goto :eof
)
set "TLS_STATE=configured"
goto :eof

REM Read APP_PORT and OPENCODE_SERVER_URL from .env into BACKEND_PORT / OC_URL.
:read_env
set "BACKEND_PORT=7171"
set "OC_URL="
set "TLS_ON="
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="APP_PORT" set "BACKEND_PORT=%%b"
    if "%%a"=="OPENCODE_SERVER_URL" set "OC_URL=%%b"
    if "%%a"=="APP_TLS_CERT_PATH" if not "%%b"=="" set "TLS_ON=1"
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

REM Exports LAN_IP = this machine's LAN IPv4, used for the phone URL in the
REM READY panels, plus LAN_IP_ALT1 / LAN_IP_ALT2 when more than one usable
REM adapter is up.
REM
REM "The first Up adapter that owns a gateway" is not good enough: Hyper-V,
REM WSL, Docker and VPN adapters are Up, carry an address and often a gateway
REM too, so the panel used to print an address the phone can never reach. The
REM probe ranks every candidate instead: physical adapters before virtual
REM ones, then a default gateway, then a link Windows marks as Internet, then
REM the lowest InterfaceMetric (the route Windows itself prefers). Adapter
REM descriptions naming a VPN / tunnel product are dropped from the physical
REM set but still come back when nothing else is left, so the panel never goes
REM blind. The runner-ups print as Alt IP rows, which keeps the reachable
REM address on screen even when the ranking picks the wrong network first.
REM
REM APP_LAN_IP overrides all of it (explicit env var first, then .env): no
REM automatic rule is right on every machine, and the manual value is the
REM guarantee.
REM
REM The pipes are NOT escaped: the whole expression is a single double-quoted
REM argument, so cmd passes them to PowerShell as operators. A "^|" would be
REM read as a literal caret-pipe and the command would fail.
REM The ipconfig fallback only covers hosts where PowerShell is blocked, so a
REM missing LAN_IP leaves the panel showing localhost alone. It cannot tell
REM adapters apart, so 169.254 APIPA addresses are its only extra filter.
:lan_ip
set "LAN_IP="
set "LAN_IP_ALT1="
set "LAN_IP_ALT2="
set "LAN_IF="
set "LAN_IF_ALT1="
set "LAN_IF_ALT2="
set "LAN_MANUAL="
if not defined APP_LAN_IP if exist ".env" for /f "usebackq tokens=1,2 delims==" %%a in (".env") do if "%%a"=="APP_LAN_IP" if not "%%b"=="" set "APP_LAN_IP=%%b"
if defined APP_LAN_IP set "LAN_IP=%APP_LAN_IP:http://=%"
if defined APP_LAN_IP set "LAN_IP=%LAN_IP:https://=%"
if defined APP_LAN_IP set "LAN_IP=%LAN_IP:/=%"
if defined APP_LAN_IP set "LAN_IP=%LAN_IP: =%"
if defined LAN_IP set "LAN_MANUAL=1" & goto :eof
for /f "tokens=1,2 delims=|" %%i in ('powershell -NoProfile -Command "$c=@(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address -and $_.IPv4Address[0].IPAddress -notmatch '^(127\.|169\.254\.)' }); $c=$c | Sort-Object @{Expression={[int]($_.NetAdapter.Virtual -eq $true)}},@{Expression={if($_.IPv4DefaultGateway){0}else{1}}},@{Expression={if($_.NetProfile.IPv4Connectivity -eq 'Internet'){0}else{1}}},@{Expression={[int]$_.NetIPInterface.InterfaceMetric}},InterfaceIndex; $p=@($c | Where-Object { $_.NetAdapter.Virtual -ne $true -and $_.NetAdapter.InterfaceDescription -notmatch 'VPN|TAP|Tunnel|Virtual|Hyper-V|VMware|VirtualBox|Docker|WSL|Bluetooth|Zscaler|AnyConnect|GlobalProtect|Sangfor|Netskope|OpenVPN|WireGuard|Tailscale|ZeroTier|Hamachi|Radmin' }); if($p.Count -eq 0){$p=@($c)}; $p | Select-Object -First 3 | ForEach-Object { $_.IPv4Address[0].IPAddress + '|' + $_.InterfaceAlias }" 2^>nul') do (
  if not defined LAN_IP (set "LAN_IP=%%i" & set "LAN_IF=%%j") else if not defined LAN_IP_ALT1 (set "LAN_IP_ALT1=%%i" & set "LAN_IF_ALT1=%%j") else if not defined LAN_IP_ALT2 (set "LAN_IP_ALT2=%%i" & set "LAN_IF_ALT2=%%j")
)
if defined LAN_IP goto :eof
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v /c:"127.0.0.1" ^| findstr /v /c:"169.254" ^| findstr /v /c:"(none)"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    set "LAN_IP=%%b"
    goto :eof
  )
)
goto :eof

REM The banner header line carrying that address. It sits right under the
REM banner in every mode, so the IP is the first thing on screen instead of
REM arriving only after the build finishes - which is exactly when you are
REM standing there with your phone wanting to connect.
REM Alt IP rows list the runner-up adapters :lan_ip ranked second and third,
REM so a PC on several networks still shows every address the phone could try.
REM The adapter name follows in gray - it is what tells Wi-Fi from Ethernet
REM when both are listed.
REM Label is padded to 11 chars so the value lines up with the Status /
REM Frontend / Backend rows in the READY panels below.
REM LAN_IP is deliberately NOT setlocal-scoped: the READY panels reuse it to
REM print the phone URL, so the PowerShell probe runs once per launch instead
REM of twice. They still re-detect if it is empty, which keeps them correct
REM even if the order is ever changed.
:show_ip
call :lan_ip
if defined LAN_IP if defined LAN_IF echo   %C_GRAY%Device IP%C_RESET%  %C_CYAN%%LAN_IP%%C_RESET%  %C_GRAY%^(%LAN_IF%^)%C_RESET%
if defined LAN_IP if not defined LAN_IF echo   %C_GRAY%Device IP%C_RESET%  %C_CYAN%%LAN_IP%%C_RESET%  %C_GRAY%^(APP_LAN_IP^)%C_RESET%
if defined LAN_IP_ALT1 echo   %C_GRAY%Alt IP   %C_RESET%  %C_CYAN%%LAN_IP_ALT1%%C_RESET%  %C_GRAY%^(%LAN_IF_ALT1%^)%C_RESET%
if defined LAN_IP_ALT2 echo   %C_GRAY%Alt IP   %C_RESET%  %C_CYAN%%LAN_IP_ALT2%%C_RESET%  %C_GRAY%^(%LAN_IF_ALT2%^)%C_RESET%
goto :eof

REM ==========================================================================
REM  INTERACTIVE MENU (additive - plain "build.bat" still starts Dev directly)
REM ==========================================================================
:menu
call :banner
call :section "SELECT MODE"
echo   %C_CYAN%[1]%C_RESET%  %C_BOLD%DEVELOPMENT%C_RESET%
echo        %C_GRAY%Hot reload  ·  Live development  ·  Port 5173%C_RESET%
echo.
echo   %C_CYAN%[2]%C_RESET%  %C_BOLD%PRODUCTION%C_RESET%
echo        %C_GRAY%Optimized build  ·  Single port server%C_RESET%
echo.
echo   %C_CYAN%[3]%C_RESET%  %C_BOLD%SYSTEM CHECK%C_RESET%
echo        %C_GRAY%Validate environment and configuration%C_RESET%
echo.
echo   %C_CYAN%[Q]%C_RESET%  %C_BOLD%EXIT%C_RESET%
echo.
choice /C 123Q /N /M "  Select an option [1/2/3/Q]: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto :check
if errorlevel 2 goto :prod
goto :dev

REM Environment check only.
:check
call :banner
call :show_ip
echo.
call :env_check
call :read_env
call :section "CONFIGURATION"
echo   %C_GRAY%Backend port%C_RESET%      %C_CYAN%%BACKEND_PORT%%C_RESET%
echo   %C_GRAY%Frontend port%C_RESET%     5173
echo   %C_GRAY%Backend language%C_RESET%  %APP_LANG% %C_DIM%^(console output^)%C_RESET%
if defined TLS_ON (echo   %C_GRAY%TLS%C_RESET%               %ICON_OK%%C_RESET%  enabled %C_DIM%^(phone mic + push work^)%C_RESET%) else (echo   %C_GRAY%TLS%C_RESET%               %ICON_WARN%%C_RESET%  off %C_DIM%^(http only - phone mic blocked^)%C_RESET%)
if "%CERT_STATE%"=="created" echo   %C_GRAY%Certificate%C_RESET%       %ICON_OK%%C_RESET%  generated + CA trusted
if "%CERT_STATE%"=="renewed" echo   %C_GRAY%Certificate%C_RESET%       %ICON_OK%%C_RESET%  renewed for the current IP
if "%CERT_STATE%"=="present" echo   %C_GRAY%Certificate%C_RESET%       %ICON_OK%%C_RESET%  found %C_DIM%^(cert\server.pem^)%C_RESET%
if "%CERT_STATE%"=="no-mkcert" echo   %C_GRAY%Certificate%C_RESET%       %ICON_WARN%%C_RESET%  mkcert missing - install it, then rerun
if "%CERT_STATE%"=="generate-failed" echo   %C_GRAY%Certificate%C_RESET%       %ICON_ERR%%C_RESET%  generation failed
REM Always printed: this is the file to install on the phone once per device.
if defined CA_EXPORT echo   %C_GRAY%Phone CA%C_RESET%          %C_CYAN%%CA_EXPORT%%C_RESET%
if defined TLS_ON (echo   %C_GRAY%Health%C_RESET%            %C_CYAN%https://127.0.0.1:%BACKEND_PORT%/api/health%C_RESET%) else (echo   %C_GRAY%Health%C_RESET%            %C_CYAN%http://127.0.0.1:%BACKEND_PORT%/api/health%C_RESET%)
echo.
if not defined OC_URL call :ensure_opencode_cli
if not defined OC_URL echo   %C_GRAY%OpenCode CLI%C_RESET%      %ICON_OK%%C_RESET%  %C_CYAN%%OPENCODE_CLI_V%%C_RESET%
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
echo   %C_BOLD%%C_CYAN%PRODUCTION MODE%C_RESET%  %C_DIM%·%C_RESET%  %C_GRAY%single port server%C_RESET%
echo.
call :show_ip
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
REM No :step_done here - every check row already carries its own ✓, so a
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
echo %C_DIM%  │%C_RESET%    %C_CYAN%^>^>%C_RESET%  Building for production...
call npm run build
if errorlevel 1 (
  call :step_fail 4
  call :fatal "Build failed." "Fix the errors above and retry."
  exit /b 1
)
echo %C_DIM%  │%C_RESET%    %ICON_OK%%C_RESET%  Build              done
call :step_done 4
call :spine

call :ready_box "REMOTECODE IS READY" "PRODUCTION MODE"
echo.
echo   %C_BOLD%%C_BLUE%STATUS%C_RESET%
echo   %ICON_RUN%%C_RESET%  %C_GREEN%%C_BOLD%SERVER RUNNING%C_RESET%
echo   %C_GRAY%Mode%C_RESET%      Production %C_DIM%^(single port - 5173 stays closed, this is normal^)%C_RESET%
echo.
echo   %C_BOLD%%C_BLUE%ACCESS%C_RESET%
REM TLS decides the URL scheme for every address in this panel and for the
REM health probe :waitopen runs below: with a certificate the backend serves
REM HTTPS only, so an http:// address would never connect.
set "WO_SCHEME=http"
if defined TLS_ON set "WO_SCHEME=https"
echo   %C_GRAY%Application%C_RESET%  %C_CYAN%%WO_SCHEME%://localhost:%BACKEND_PORT%%C_RESET%
REM Reuses the LAN_IP :show_ip already detected under the banner; the probe
REM is only repeated if that line somehow never ran. Alt URL rows carry the
REM other LAN candidates :lan_ip found, so the right network is still one
REM copy-paste away when the top pick is not the phone's network.
if not defined LAN_IP call :lan_ip
if defined LAN_IP echo   %C_GRAY%Phone%C_RESET%        %C_CYAN%%WO_SCHEME%://%LAN_IP%:%BACKEND_PORT%%C_RESET%  %C_GRAY%^(same Wi-Fi, no VPN^)%C_RESET%
if defined LAN_IP_ALT1 echo   %C_GRAY%Alt URL%C_RESET%      %C_CYAN%%WO_SCHEME%://%LAN_IP_ALT1%:%BACKEND_PORT%%C_RESET%  %C_GRAY%^(%LAN_IF_ALT1%^)%C_RESET%
if defined LAN_IP_ALT2 echo   %C_GRAY%Alt URL%C_RESET%      %C_CYAN%%WO_SCHEME%://%LAN_IP_ALT2%:%BACKEND_PORT%%C_RESET%  %C_GRAY%^(%LAN_IF_ALT2%^)%C_RESET%
echo.
echo   %C_BOLD%%C_BLUE%SECURITY%C_RESET%
if defined TLS_ON (echo   %ICON_OK%%C_RESET%  %C_GREEN%HTTPS enabled%C_RESET% %C_DIM%^(trusted cert - phone mic + push work^)%C_RESET%) else (echo   %ICON_WARN%%C_RESET%  %C_YELLOW%HTTP only%C_RESET% - the phone microphone is blocked without HTTPS)
if defined LAN_IP if defined TLS_ON echo   %C_GRAY%Accept the certificate warning once per device.%C_RESET%
REM Same CA row as dev: the phone has to trust this file for HTTPS + mic.
if defined CA_EXPORT echo   %C_GRAY%Phone CA%C_RESET%     %C_CYAN%%CA_EXPORT%%C_RESET%
echo.
call :footer
echo   Starting production server ^(Ctrl+C to stop^)...
echo   Opening %C_CYAN%%WO_SCHEME%://localhost:%BACKEND_PORT%%C_RESET% in your browser once the server is up...
start "OpenCode browser wait" /min cmd /c ""%~f0" waitopen %BACKEND_PORT% - %WO_SCHEME%://localhost:%BACKEND_PORT% %WO_SCHEME%"
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
echo   %C_BOLD%%C_CYAN%DEVELOPMENT MODE%C_RESET%  %C_DIM%·%C_RESET%  %C_GRAY%Vite 5173 + backend%C_RESET%
echo.
call :show_ip
echo.

REM Same shape as prod, but dev also builds the client for the phone:
REM 1 = :env_check, 2 = firewall rules, 3 = :ensure_opencode_cli,
REM 4 = vite build (serves the HTTPS origin the phone opens), 5 = :port_check x2.
set "STEP_NAME_1=Check environment"
set "STEP_NAME_2=Configure network"
set "STEP_NAME_3=Ensure OpenCode CLI"
set "STEP_NAME_4=Build for phone"
set "STEP_NAME_5=Check ports"
call :steps_begin "Start Project"

call :step_start 1
call :env_check
REM No :step_done here - every check row already carries its own ✓.
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

REM Build the client before starting: the backend serves dist/ on APP_PORT,
REM and the phone opens that exact HTTPS origin for the mic + PWA - without
REM a build here it meets whatever stale bundle the last build left behind
REM (the same reason a retired version number lingers on the phone).
call :step_start 4
call :step_info "vite build for the phone HTTPS origin"
echo %C_DIM%  │%C_RESET%    %C_CYAN%^>^>%C_RESET%  Building frontend...
call npm run build:client --silent
if errorlevel 1 (
  call :step_fail 4
  call :fatal "Build failed." "Fix the errors above and retry."
  exit /b 1
)
echo %C_DIM%  │%C_RESET%    %ICON_OK%%C_RESET%  Build              done
call :step_done 4
call :spine

call :port_check 5173
call :port_check %BACKEND_PORT%
call :step_now 5 "Ports  5173 + %BACKEND_PORT% checked"

REM Same scheme decision as prod: :read_env knows whether TLS is on, and
REM both the backend row and the :waitopen health probe have to match it.
set "WO_SCHEME=http"
if defined TLS_ON set "WO_SCHEME=https"

call :ready_box "REMOTECODE IS READY" "DEVELOPMENT MODE"
echo.
echo   %C_BOLD%%C_BLUE%STATUS%C_RESET%
echo   %ICON_RUN%%C_RESET%  %C_GREEN%%C_BOLD%STARTING%C_RESET% %C_DIM%^(live log below^)%C_RESET%
echo   %C_GRAY%Frontend%C_RESET%   %C_CYAN%http://localhost:5173%C_RESET%
echo   %C_GRAY%Backend%C_RESET%    %C_CYAN%%WO_SCHEME%://localhost:%BACKEND_PORT%%C_RESET%
echo.
echo   %C_BOLD%%C_BLUE%PHONE%C_RESET%
REM The phone talks to Vite here, not to the backend: 5173 is what the dev
REM server binds on 0.0.0.0, and it proxies the API to APP_PORT itself.
REM Reuses the LAN_IP :show_ip already detected under the banner; the probe
REM is only repeated if that line somehow never ran. Alt URL rows carry the
REM other LAN candidates :lan_ip found, so the right network is still one
REM copy-paste away when the top pick is not the phone's network.
if not defined LAN_IP call :lan_ip
if defined LAN_IP echo   %C_GRAY%Open%C_RESET%       %C_CYAN%http://%LAN_IP%:5173%C_RESET%  %C_GRAY%^(same Wi-Fi, no VPN^)%C_RESET%
if defined LAN_IP_ALT1 echo   %C_GRAY%Alt URL%C_RESET%    %C_CYAN%http://%LAN_IP_ALT1%:5173%C_RESET%  %C_GRAY%^(%LAN_IF_ALT1%^)%C_RESET%
if defined LAN_IP_ALT2 echo   %C_GRAY%Alt URL%C_RESET%    %C_CYAN%http://%LAN_IP_ALT2%:5173%C_RESET%  %C_GRAY%^(%LAN_IF_ALT2%^)%C_RESET%
echo.
echo   %C_BOLD%%C_BLUE%SECURITY%C_RESET%
if not defined TLS_ON echo   %ICON_WARN%%C_RESET%  %C_YELLOW%HTTP only%C_RESET% - the phone microphone is blocked without HTTPS
REM In dev the certificate is served by the backend on APP_PORT, so the
REM phone can reach it directly for a trusted HTTPS origin (the mic needs
REM one, and Vite's own dev server has no TLS). The proxy in vite.config.ts
REM follows APP_TLS_* and talks https to the backend, so both paths work.
if defined TLS_ON if defined LAN_IP echo   %ICON_OK%%C_RESET%  %C_GREEN%HTTPS enabled%C_RESET%  %C_CYAN%https://%LAN_IP%:%BACKEND_PORT%%C_RESET%  %C_DIM%^(use this for the microphone^)%C_RESET%
if defined TLS_ON if defined LAN_IP echo   %C_GRAY%Accept the certificate warning once per device.%C_RESET%
REM The CA file the phone has to trust. Printed every run so the path is
REM always one glance away instead of an mkcert -CAROOT lookup.
if defined CA_EXPORT echo   %C_GRAY%Phone CA%C_RESET%   %C_CYAN%%CA_EXPORT%%C_RESET%
if defined CA_EXPORT if defined TLS_ON echo   %C_GRAY%Install once on the phone to trust the HTTPS origin.%C_RESET%
echo.
call :footer
echo   Opening %C_CYAN%http://localhost:5173%C_RESET% in your browser once backend + frontend are up...
start "OpenCode browser wait" /min cmd /c ""%~f0" waitopen %BACKEND_PORT% 5173 http://localhost:5173 %WO_SCHEME%"
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
REM   build.bat waitopen <backendPort> <frontendPort|-> <url> [http|https]
REM The optional scheme is the backend one: with TLS configured the server is
REM HTTPS-only, so an http probe would never succeed, the helper would sit out
REM its whole timeout and the browser would never open. Defaults to http.
REM "-" skips the frontend check (prod = backend only). Gives up after ~2 min
REM so a failed start never leaves an orphan polling loop behind.
REM ---------------------------------------------------------------------------
:waitopen
set "WO_BACKEND=%~2"
set "WO_FRONTEND=%~3"
set "WO_URL=%~4"
set "WO_SCHEME=%~5"
if not defined WO_SCHEME set "WO_SCHEME=http"
set /a "WO_TRIES=0"
:waitopen_loop
set /a "WO_TRIES+=1"
if %WO_TRIES% GTR 120 exit /b 0
REM --insecure: a liveness probe, not a trust decision. curl validates via the
REM Windows store (Schannel) and mkcert installs its CA there, but even an
REM untrusted certificate must not stop the helper from opening the browser.
curl --insecure --fail --silent --output nul --max-time 2 "%WO_SCHEME%://127.0.0.1:%WO_BACKEND%/api/health" <nul >nul 2>&1
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
