; Acira premium one-click installer: a borderless branded window (pre-rendered scene bitmaps, real progress line), no wizard.
; Scene bitmaps come from scripts/installer-art-main.cjs (packaging/installer/*.bmp at 100/125/150/200%).
!include "LogicLib.nsh"
; Registry and data names. A QA build (acira-installer-qa.nsh, from `node scripts/release.mjs --qa-identity`) defines ACIRA_QA first, so a
; QA install or uninstall writes and removes only its own keys and never the real Acira's (its uninstall GUID, Start-menu name and default
; folder differ too: packaging/signing-config.cjs). tests/qa-identity.test.cjs keeps every name here distinct.
!ifdef ACIRA_QA
  !define AC_REG_KEY "Software\AciraBrowserQA"
  !define AC_REG_APP "Acira Browser QA"
  !define AC_PROGID "AciraBrowserQA.Url"
  !define AC_DATA_DIR "AciraBrowserQA"
  !define AC_APP_EXE "AciraBrowserQA.exe"
  ; Beta 14 (brief B9): the "installed here before" marker that "delete my data" leaves (below). A QA build has its own, never read (QA builds send nothing).
  !define AC_RETURN_KEY "Software\AciraBrowserQAInstalledBefore"
!else
  !define AC_REG_KEY "Software\AciraBrowser"
  !define AC_REG_APP "Acira Browser"
  !define AC_PROGID "AciraBrowser.Url"
  !define AC_DATA_DIR "AciraBrowser"
  !define AC_APP_EXE "AciraBrowser.exe"
  ; a key the uninstaller never removes (AC_REG_KEY is removed); the app reads it (desktop/browser-services/install-mark.cjs, WINDOWS_KEY) and the remover writes it too (AciraUninstall.cs)
  !define AC_RETURN_KEY "Software\AciraBrowserInstalledBefore"
!endif
;
; Where the Windows uninstaller sends its one usage message (Acira's usage function: desktop/browser-services/metrics-config.cjs has the same
; address, and tests/usage-uninstall.test.cjs keeps the two equal). A QA build never sends it: QA rigs install and remove that build many
; times, and none of that is a person leaving.
!ifdef ACIRA_QA
  !define AC_USAGE_HOST ""
!else
  !define AC_USAGE_HOST "lzdndhalljkmqabbtruv.supabase.co"
!endif
!define AC_USAGE_PATH "/functions/v1/usage"
; Acira for Windows ships for x64 only (packaging/electron-builder.json); on an ARM PC that build runs as x64, which is what the app reports too.
!define AC_USAGE_ARCH "x64"
; Defining customCheckAppRunning replaces the stock include of these, so bring them in here.
!include "getProcessInfo.nsh"
Var pid
; Setup and uninstaller are both DPI aware for the sign-in scale: each picks its 100, 150 or 200% picture from it (AcStyleBanner,
; customUnInit), so the uninstall splash is always the size of the setup window, and Windows draws the message boxes sharp and full size.
; (beta.9 and earlier: the uninstaller was not DPI aware, so Windows stretched its 100% splash by the exact scale, smaller than the setup
; window at 125% and 175%.)
ManifestDPIAware true
!ifndef BUILD_UNINSTALLER
Var acTheme
Var acScale
Var acWnd
; D141: an update replaces the old version's files itself (AcOwnReplaceBegin and the functions after it)
Var acOwnReplace    ; 1 = this run replaces the old files itself and has taken the old version's remover out of the registry; 2 = its move was tried
Var acOldDir        ; the folder beside the install folder that holds the old version while the new one is installed ("" = nothing is moved)
Var acOldUninstall  ; what the registry said before this run, written back whenever the old version stays or comes back
Var acOldQuiet
Var acOldVersion
Var acOldUninstall2
Var acOldQuiet2
!define AC_W 560
!define AC_H 340
!define AC_TX 28
!define AC_TY 314
!define AC_TW 504
!define AC_TH 1

; The stock one-click window (title bar, "Installing, please wait…", grey bar) must never reach the screen: from the moment the GUI
; exists it is fully transparent and has no taskbar button, so the first thing anyone sees is Acira's own window (AcStyleBanner).
!define MUI_CUSTOMFUNCTION_GUIINIT AcHideStockWindow
Function AcHideStockWindow
  IfSilent acHideDone
  Push $0
  Push $1
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i .r0'
  ; + WS_EX_LAYERED | WS_EX_TOOLWINDOW, - WS_EX_APPWINDOW
  IntOp $0 $0 | 0x80080
  IntOp $1 0x40000 ~
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i r0)'
  ; LWA_ALPHA, alpha 0
  System::Call 'user32::SetLayeredWindowAttributes(p $HWNDPARENT, i 0, i 0, i 2)'
  Pop $1
  Pop $0
  acHideDone:
FunctionEnd

; The scene player (frames embedded): used by the installer window and by /preview.
Function AcExtractHelper
  InitPluginsDir
  File "/oname=$PLUGINSDIR\acira-progress.exe" "${BUILD_RESOURCES_DIR}\installer\acira-progress.exe"
FunctionEnd

Function AcStyleBanner
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  ; The visible one-click window is $HWNDPARENT; the stock banner dialog (with the progress bar) is a child of it.
  FindWindow $6 "#32770" "" $HWNDPARENT
  FindWindow $6 "#32770" "" $HWNDPARENT $6
  ; Hide the stock window and banner before anything else (they are already transparent, see AcHideStockWindow).
  ShowWindow $HWNDPARENT 0
  ${If} $6 <> 0
    ShowWindow $6 0
  ${EndIf}
  InitPluginsDir
  ; The installer is always dark, whatever the Windows theme is (founder decision, 25 Oct).
  StrCpy $acTheme "dark"
  ; Pick the bitmap that matches the screen scale ($9 = 100, 150 or 200).
  System::Call 'user32::GetDC(p 0) p .r0'
  System::Call 'gdi32::GetDeviceCaps(p r0, i 88) i .r1'
  System::Call 'user32::ReleaseDC(p 0, p r0)'
  ${If} $1 < 96
    StrCpy $1 96
  ${EndIf}
  IntOp $2 $1 * 100
  IntOp $2 $2 / 96
  StrCpy $9 100
  ${If} $2 >= 125
    StrCpy $9 150
  ${EndIf}
  ${If} $2 >= 175
    StrCpy $9 200
  ${EndIf}
  StrCpy $acScale $9
  ; Only this screen's two scenes are unpacked before the window goes up (the scene player follows once the window is on screen).
  ${If} $9 = 200
    File "/oname=$PLUGINSDIR\ac-dark-1-200.bmp" "${BUILD_RESOURCES_DIR}\installer\install-dark-1-200.bmp"
    File "/oname=$PLUGINSDIR\ac-dark-2-200.bmp" "${BUILD_RESOURCES_DIR}\installer\install-dark-2-200.bmp"
  ${ElseIf} $9 = 150
    File "/oname=$PLUGINSDIR\ac-dark-1-150.bmp" "${BUILD_RESOURCES_DIR}\installer\install-dark-1-150.bmp"
    File "/oname=$PLUGINSDIR\ac-dark-2-150.bmp" "${BUILD_RESOURCES_DIR}\installer\install-dark-2-150.bmp"
  ${Else}
    File "/oname=$PLUGINSDIR\ac-dark-1-100.bmp" "${BUILD_RESOURCES_DIR}\installer\install-dark-1-100.bmp"
    File "/oname=$PLUGINSDIR\ac-dark-2-100.bmp" "${BUILD_RESOURCES_DIR}\installer\install-dark-2-100.bmp"
  ${EndIf}
  ; $3 = width, $4 = height in pixels
  IntOp $3 ${AC_W} * $9
  IntOp $3 $3 / 100
  IntOp $4 ${AC_H} * $9
  IntOp $4 $4 / 100
  ; The stock banner (second dialog) owns the progress bar that SpiderBanner keeps updating (control 1001); move it onto the main window.
  StrCpy $2 0
  ${If} $6 <> 0
    GetDlgItem $2 $6 1001
  ${EndIf}
  ; Our own borderless, topmost popup window (no stray stock controls), centred on the screen.
  System::Call 'user32::GetSystemMetrics(i 0) i .r0'
  System::Call 'user32::GetSystemMetrics(i 1) i .r1'
  IntOp $0 $0 - $3
  IntOp $0 $0 / 2
  IntOp $1 $1 - $4
  IntOp $1 $1 / 2
  System::Call 'user32::CreateWindowExW(i 136, w "STATIC", w "Acira Browser Setup", i -1879048178, i r0, i r1, i r3, i r4, p 0, p 0, p 0, p 0) p .r7'
  StrCpy $acWnd $7
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\ac-$acTheme-1-$acScale.bmp", i 0, i 0, i 0, i 0x10) p .r8'
  SendMessage $7 0x172 0 $8
  ; Rounded corners: native on Windows 11, a window region on Windows 10.
  System::Call 'dwmapi::DwmSetWindowAttribute(p r7, i 33, *i 2, i 4) i .r0'
  ${If} $0 <> 0
    IntOp $1 $9 * 16
    IntOp $1 $1 / 100
    IntOp $5 $3 + 1
    IntOp $8 $4 + 1
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i r5, i r8, i r1, i r1) p .r0'
    System::Call 'user32::SetWindowRgn(p r7, p r0, i 1)'
  ${EndIf}
  System::Call 'user32::SetWindowPos(p r7, p -1, i 0, i 0, i 0, i 0, i 0x43)'
  System::Call 'user32::UpdateWindow(p r7)'
  Call AcExtractHelper
  ; The progress line is drawn by a tiny helper (its own thread, per-pixel alpha), so it stays smooth while this thread extracts.
  ; Payload temp file first (copied out of the installer), then the install directory; see AciraProgress.cs.
  ; D141: a program is started in the setup's working folder, and electron-builder's .onInit makes that the install folder. Windows will not
  ; rename a folder a program is standing in, and the setup renames the old install folder on an update (AcOwnReplaceMove): the window's
  ; program stands in the setup's own Temp folder instead. The working folder is put back for everything after.
  SetOutPath "$PLUGINSDIR"
  Exec '"$PLUGINSDIR\acira-progress.exe" $acWnd $acTheme $acScale "$PLUGINSDIR\ac-done.flag" "$INSTDIR" ${ESTIMATED_SIZE} "$PLUGINSDIR\app-64.7z" "$EXEPATH"'
  SetOutPath "$INSTDIR"
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Second scene (light has bloomed) for the end of the copy; called from customInstall.
Function AcStage2
  Push $0
  Push $1
  FileOpen $0 "$PLUGINSDIR\ac-done.flag" w
  ${If} $0 != ""
    FileClose $0
  ${EndIf}
  ${If} $acWnd <> 0
    System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\ac-$acTheme-2-$acScale.bmp", i 0, i 0, i 0, i 0x10) p .r0'
    ${If} $0 <> 0
      SendMessage $acWnd 0x172 0 $0 $1
      System::Call 'gdi32::DeleteObject(p r1)'
    ${EndIf}
  ${EndIf}
  ; let the finish bloom play before the app opens (the player closes itself)
  ${If} $acWnd <> 0
    Sleep 2400
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

!endif

; `setup.exe /preview` plays the installer window (scene, line, finish) in a loop until it is closed; it installs nothing and writes no registry.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${GetParameters} $R0
    ${GetOptions} $R0 "/preview" $R1
    ${IfNot} ${Errors}
      Call AcExtractHelper
      ExecWait '"$PLUGINSDIR\acira-progress.exe" --preview'
      Quit
    ${EndIf}
    ClearErrors
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
; --- D147 / D149 (14.3): the running-app check must not wait for ever ---------------------------------------------------------------------------------------
; electron-builder's check (_CHECK_APP_RUNNING with FIND_PROCESS, KILL_PROCESS and IS_POWERSHELL_AVAILABLE, allowOnlyOneInstallerInstance.nsh) starts PowerShell or
; tasklist with nsExec::Exec and waits for it WITHOUT a limit. A PowerShell that never returns (WMI stuck, a scanner holding it) left the setup running in the
; background for ever, with nothing on screen, and the setup holds its own file (AciraBrowserSetup.exe in the updater's pending folder): the next update could not
; replace it (D149). The setup now has its own copy of the check in which every one of those programs gets AC_PROBE_MS, the same commands as the stock macros
; (tests/windows-setup-probe-limit.test.cjs compares them with the template). A probe that does not answer in time is read as "not running": the setup goes on,
; and what Acira would still hold stops the update at the own-replace step, which rolls back and exits with code 2 (D141), instead of waiting. The uninstaller pass keeps the stock check.
!define AC_PROBE_MS 15000
Var acPsPath
Var acCmdPath
Var acPsOff

; Runs the command on the stack and leaves its exit code on the stack, or "timeout" (nothing came back in AC_PROBE_MS, nsExec stops waiting; the NSIS
; documentation says it ends the program) or "error" (it could not be started). Registers are left as they were.
Function AcProbe
  Exch $0
  nsExec::Exec /TIMEOUT=${AC_PROBE_MS} `$0`
  Pop $0
  Exch $0
FunctionEnd

; Stock IS_POWERSHELL_AVAILABLE plus the quote rule of AcQuoteInInstdir: $acPsOff is 0 when PowerShell can be used for the check, 1 when not (it did not answer,
; is blocked by policy, or the install folder holds a quote that breaks the stock command). Sets the paths the other probes use.
Function AcPowerShellProbe
  Push $0
  Push $1
  StrCpy $acCmdPath "$SYSDIR\cmd.exe"
  StrCpy $acPsPath "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  Push `"$acPsPath" -C "if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Call AcProbe
  Pop $0
  ${If} $0 == 0
    Push `"$acPsPath" -C "if ((Get-ExecutionPolicy -Scope Process) -eq 'Restricted') { exit 1 } else { exit 0 }"`
    Call AcProbe
    Pop $0
  ${EndIf}
  ${If} $0 != 0
    StrCpy $0 1
  ${EndIf}
  Call AcQuoteInInstdir
  Pop $1
  ${If} $1 = 1
    StrCpy $0 1
  ${EndIf}
  StrCpy $acPsOff $0
  Pop $1
  Pop $0
FunctionEnd

; Stock FIND_PROCESS, on the stack: 0 when Acira runs, 1 when it does not (and when the probe gave no answer in time).
Function AcFindAcira
  Push $0
  ${If} $acPsOff == 0
    StrCpy $0 `"$acPsPath" -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }"`
  ${Else}
    !ifdef INSTALL_MODE_PER_ALL_USERS
      StrCpy $0 `"$acCmdPath" /C tasklist /FI "IMAGENAME eq ${PRODUCT_FILENAME}.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${PRODUCT_FILENAME}.exe\""`
    !else
      StrCpy $0 `"$acCmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${PRODUCT_FILENAME}.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${PRODUCT_FILENAME}.exe\""`
    !endif
  ${EndIf}
  Push $0
  Call AcProbe
  Pop $0
  ${If} $0 != 0
    StrCpy $0 1
  ${EndIf}
  Exch $0
FunctionEnd

; Stock KILL_PROCESS; the force flag (0 or 1) is on the stack. The answer is not used.
Function AcKillAcira
  Exch $1
  Push $0
  ${If} $acPsOff == 0
    ${If} $1 == 1
      StrCpy $0 "-Force"
    ${Else}
      StrCpy $0 ""
    ${EndIf}
    StrCpy $1 `"$acPsPath" -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId $0 }"`
  ${Else}
    ${If} $1 == 1
      StrCpy $0 "/F"
    ${Else}
      StrCpy $0 ""
    ${EndIf}
    !ifdef INSTALL_MODE_PER_ALL_USERS
      StrCpy $1 `taskkill /IM "${PRODUCT_FILENAME}.exe" /FI "PID ne $pid"`
    !else
      StrCpy $1 `"$acCmdPath" /C taskkill $0 /IM "${PRODUCT_FILENAME}.exe" /FI "PID ne $pid" /FI "USERNAME eq %USERNAME%"`
    !endif
  ${EndIf}
  Push $1
  Call AcProbe
  Pop $0
  Pop $0
  Pop $1
FunctionEnd

; Stock _CHECK_APP_RUNNING with Call AcFindAcira / Call AcKillAcira for FIND_PROCESS / KILL_PROCESS (a macro, not a Function: it shows electron-builder's
; own message boxes, whose texts are only defined later). Its two waits for the person (the OK / Cancel box, the Retry / Cancel box) are as before and answer
; themselves in a silent run (/SD). ${isUpdated} is not known yet where this file is read, AcUpdaterRun says the same.
!macro AcCheckAppRunning
  Call AcPowerShellProbe
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    Call AcUpdaterRun
    ${IfNot} ${Errors}
      # allow app to exit without explicit kill
      Sleep 300
    ${endIf}
    ClearErrors

    Call AcFindAcira
    Pop $R0
    ${if} $R0 == 0
      Call AcUpdaterRun
      ${IfNot} ${Errors}
        # allow app to exit without explicit kill
        Sleep 1000
        Goto acDoStopProcess
      ${endIf}
      ClearErrors
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK acDoStopProcess
      Quit

      acDoStopProcess:

      DetailPrint "$(appClosing)"

      Push 0
      Call AcKillAcira
      # to ensure that files are not "in-use"
      Sleep 300

      # Retry counter
      StrCpy $R1 0

      acLoop:
        IntOp $R1 $R1 + 1

        Call AcFindAcira
        Pop $R0
        ${if} $R0 == 0
          # wait to give a chance to exit gracefully
          Sleep 1000
          Push 1
          Call AcKillAcira # 1 = force kill
          Call AcFindAcira
          Pop $R0
          ${if} $R0 == 0
            DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
            Sleep 2000
          ${else}
            Goto acNotRunning
          ${endIf}
        ${else}
          Goto acNotRunning
        ${endIf}

        # App likely running with elevated permissions.
        # Ask user to close it manually
        ${if} $R1 > 1
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY acLoop
          Quit
        ${else}
          Goto acLoop
        ${endIf}
      acNotRunning:
    ${endIf}
  ${endIf}
!macroend
!endif

; The one-click installer shows a small banner window; restyle it as soon as it exists, then run the standard running-app check.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; silent runs (the updater) show nothing
    IfSilent acNoBanner
    Call AcStyleBanner
    acNoBanner:
    ; before electron-builder runs the old version's uninstaller (uninstallOldVersion comes right after this check)
    Call AcDropBadUninstaller
    ; electron-builder's stock check puts the install folder inside a PowerShell single-quoted string (StartsWith('$INSTDIR', ...)). A single or typographic
    ; quote in it (a Windows user named O'Brien, Ma'ruf, Ra’ed) ends that string early, PowerShell cannot parse the line and exits 1, which the check reads
    ; as "Acira is not running": the old Acira is neither waited for nor closed, the old files are in use and the update does not take. With such a folder
    ; the PowerShell way is off ($acPsOff: 0 = usable, AcPowerShellProbe) and the check takes its tasklist / taskkill branch, which names the program
    ; (AciraBrowser.exe, this user's) and never puts the folder in a command.
    ; D147 / D149 (14.3): the check is the setup's own copy of electron-builder's, every program it starts has a time limit (AC_PROBE_MS, above).
    !insertmacro AcCheckAppRunning
    ; D141: Acira is closed now. On an update the setup replaces the old files itself; electron-builder's uninstallOldVersion, which comes right
    ; after this macro, then finds no remover in the registry and starts none (no program copied to Temp, none started from there).
    Call AcOwnReplaceBegin
  !else
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  !endif
!macroend

; Electron 44 (Chromium 152) needs Windows 10 or later. electron-builder's own check stops at Windows 7, so Windows 7, 8 and 8.1 would install a browser
; that can never open. Say so plainly instead (in the PC's language; silent runs, such as the updater, just exit with code 2). GetVersion reports the
; real version because the installer's manifest lists Windows 10.
!macro customInit
  !ifndef BUILD_UNINSTALLER
    Push $0
    Push $1
    System::Call 'kernel32::GetVersion() i .r0'
    IntOp $0 $0 & 0xFF
    ${If} $0 < 10
      IfSilent acOldWindowsQuit
      System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
      IntOp $1 $0 & 0x3ff
      ${If} $1 = 10
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser necesita Windows 10 o posterior (64 bits). Este equipo usa una versión anterior de Windows."
      ${ElseIf} $1 = 12
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser nécessite Windows 10 ou version ultérieure (64 bits). Ce PC utilise une version plus ancienne de Windows."
      ${ElseIf} $1 = 7
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser benötigt Windows 10 oder neuer (64 Bit). Dieser PC verwendet eine ältere Windows-Version."
      ${ElseIf} $1 = 22
        MessageBox MB_OK|MB_ICONSTOP "O Acira Browser precisa do Windows 10 ou posterior (64 bits). Este computador usa uma versão mais antiga do Windows."
      ${ElseIf} $1 = 16
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser richiede Windows 10 o versioni successive (64 bit). Questo PC usa una versione precedente di Windows."
      ${ElseIf} $1 = 17
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser には Windows 10 以降（64 ビット）が必要です。このパソコンの Windows は古いバージョンです。"
      ${ElseIf} $0 = 2052
      ${OrIf} $0 = 4100
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser 需要 Windows 10 或更高版本（64 位）。这台电脑运行的 Windows 版本较旧。"
      ${Else}
        MessageBox MB_OK|MB_ICONSTOP "Acira Browser needs Windows 10 or later (64-bit). This PC is running an older version of Windows."
      ${EndIf}
      acOldWindowsQuit:
      SetErrorLevel 2
      Quit
    ${EndIf}
    Pop $1
    Pop $0
    Call AcAskExisting
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
; An Acira is already in the install folder (re-running setup): one branded question first, never the stock flow. Same version: Repair /
; Open Acira / Cancel; older: Update to this version / Open / Cancel; newer: Open / Cancel (no downgrade). A running Acira is asked to quit
; the ordinary way first (its session comes back). See AciraChoose.cs. Silent runs (the updater) never ask; /preview never gets here.
Function AcAskExisting
  IfSilent acAskDone
  ; Install now on Acira beta.8 and earlier runs this setup with --updated and without /S: the person already chose, so no second question
  Call AcUpdaterRun
  IfErrors 0 acAskDone
  IfFileExists "$INSTDIR\${AC_APP_EXE}" 0 acAskDone
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  InitPluginsDir
  File "/oname=$PLUGINSDIR\acira-choose.exe" "${BUILD_RESOURCES_DIR}\installer\acira-uninstall.exe"
  Delete "$PLUGINSDIR\ac-choice.txt"
  ; D141: the question's program stands in the setup's own Temp folder, not in the install folder (see AcStyleBanner), and its start is
  ; checked: when Windows will not start it (an antivirus that stops small unsigned programs in Temp) there is no 10 s wait for a window
  ; that cannot come.
  SetOutPath "$PLUGINSDIR"
  ClearErrors
  Exec '"$PLUGINSDIR\acira-choose.exe" --choose "$INSTDIR" "${VERSION}" "$PLUGINSDIR\ac-choice.txt"'
  IfErrors 0 acAskStarted
  SetOutPath "$INSTDIR"
  Goto acAskNoWindow
  acAskStarted:
  SetOutPath "$INSTDIR"
  ; Wait for the answer. The question stays up until the installer's own card covers it, so the answer comes first and the window
  ; leaves later. If the window was seen and is gone without an answer, that is Cancel; if it never shows in 10 s, the setup decides
  ; without it (acAskNoWindow).
  StrCpy $2 0
  StrCpy $3 0
  acAskWait:
    Sleep 40
    IntOp $2 $2 + 1
    IfFileExists "$PLUGINSDIR\ac-choice.txt" acAskAnswered
    System::Call 'user32::FindWindowW(p 0, w "Acira Browser Setup") p .r0'
    ${If} $0 <> 0
      StrCpy $3 1
    ${ElseIf} $3 = 1
      Goto acAskAnswered
    ${ElseIf} $2 > 250
      Goto acAskNoWindow
    ${EndIf}
    Goto acAskWait
  acAskAnswered:
  StrCpy $4 "cancel"
  ClearErrors
  FileOpen $1 "$PLUGINSDIR\ac-choice.txt" r
  ${IfNot} ${Errors}
    FileRead $1 $4
    FileClose $1
  ${EndIf}
  ${If} $4 == "proceed"
    Goto acAskGo
  ${EndIf}
  ; Cancel, or Acira was opened: nothing was changed
  ${If} $4 == "opened"
    SetErrorLevel 0
  ${Else}
    SetErrorLevel 1223
  ${EndIf}
  Quit
  acAskNoWindow:
  ; D141: the question could not be asked. The setup decides the way the card would have let the person: an older or the same Acira is
  ; replaced, a NEWER one is left alone (the card offers only Open and Cancel over a newer Acira; going on here installed the older setup over it).
  ReadRegStr $4 SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ClearErrors
  Push $4
  Push "${VERSION}"
  Call AcVersionNewer
  Pop $4
  ${If} $4 = 1
    SetErrorLevel 1223
    Quit
  ${EndIf}
  acAskGo:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  acAskDone:
FunctionEnd
!endif

; --- Updates that never stop behind a window (the co-founder's e493a626, ea5ea64b, b34487a1 and ea4a851d, on this installer) -----------------------
!ifndef BUILD_UNINSTALLER
!include "FileFunc.nsh"
; electron-builder defines UNINSTALL_FILENAME and UNINSTALL_REGISTRY_KEY after this file is read (common.nsh, multiUser.nsh), so the Functions here
; name them themselves, the same way, from the defines it passes on the command line.
!define AC_OLD_UNINSTALLER "Uninstall ${PRODUCT_FILENAME}.exe"
!define AC_OLD_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

; Clears the error flag when Acira's updater started this setup (--updated: Install now, and the update when Acira quits), sets it otherwise.
Function AcUpdaterRun
  Push $R0
  Push $R1
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  Pop $R1
  Pop $R0
FunctionEnd

; 1 on the stack when $INSTDIR holds a character that ends a PowerShell single-quoted string (' and the typographic single quotes U+2018 to U+201B),
; else 0. Registers and the rest of the stack are left as they were. Built from what electron-builder's own multiUser.nsh already compiles
; (${Do}/${LoopUntil}, StrLen, StrCpy with a length and an offset, ${OrIf}).
Function AcQuoteInInstdir
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $3 0
  StrLen $1 "$INSTDIR"
  StrCpy $0 0
  ${If} $1 > 0
    ${Do}
      StrCpy $2 "$INSTDIR" 1 $0
      ${If} $2 == "'"
      ${OrIf} $2 == "‘"
      ${OrIf} $2 == "’"
      ${OrIf} $2 == "‚"
      ${OrIf} $2 == "‛"
        StrCpy $3 1
      ${EndIf}
      IntOp $0 $0 + 1
    ${LoopUntil} $0 >= $1
  ${EndIf}
  StrCpy $0 $3
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd



; 1 on the stack when the file is a Windows program (at least 64 KB, an MZ header, a PE header where it points) or cannot be read (nothing is
; deleted on a guess); 0 when it is cut short, zero bytes or damaged. Bytes only: FileReadWord needs a Unicode build.
Function AcExeOk
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $3 1
  ClearErrors
  FileOpen $1 "$0" r
  ${IfNot} ${Errors}
    StrCpy $3 0
    FileSeek $1 0 END $4
    ${If} $4 >= 65536
      FileSeek $1 0 SET
      FileReadByte $1 $0
      FileReadByte $1 $2
      ${If} $0 = 77
      ${AndIf} $2 = 90
        FileSeek $1 60 SET
        FileReadByte $1 $2
        FileReadByte $1 $0
        IntOp $0 $0 * 256
        IntOp $2 $2 + $0
        ${If} $2 > 0
        ${AndIf} $2 < $4
          FileSeek $1 $2 SET
          FileReadByte $1 $0
          FileReadByte $1 $2
          ${If} $0 = 80
          ${AndIf} $2 = 69
            StrCpy $3 1
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    FileClose $1
  ${EndIf}
  ClearErrors
  StrCpy $0 $3
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; The setup runs the old version's removers next: AciraRemove.exe (the registry's UninstallString), which hands a silent run to the real
; "Uninstall *.exe" and waits for it. One that is cut short, zero bytes or damaged (a broken download, antivirus) makes Windows show "Unsupported
; 16-Bit Application", which no silent run can answer: the update hung for good. A launcher whose real uninstaller is gone answers 2 five times and
; the setup ends in "Failed to uninstall old application files". Either way the damaged file goes and the registry no longer points at a remover,
; so the new version installs over the old one (settings and data untouched; the new version writes both removers again).
Function AcDropBadUninstaller
  Push $0
  Push $1
  Push $2
  StrCpy $1 0
  ${If} ${FileExists} "$INSTDIR\AciraRemove.exe"
    Push "$INSTDIR\AciraRemove.exe"
    Call AcExeOk
    Pop $0
    ${If} $0 = 0
      StrCpy $1 1
      Delete "$INSTDIR\AciraRemove.exe"
    ${EndIf}
  ${EndIf}
  ; the real uninstaller, found the way AciraRemove.exe finds it (the first "Uninstall *.exe"; older builds were named differently)
  ClearErrors
  FindFirst $0 $2 "$INSTDIR\Uninstall*.exe"
  FindClose $0
  ClearErrors
  ${If} $2 != ""
    Push "$INSTDIR\$2"
    Call AcExeOk
    Pop $0
    ${If} $0 = 0
      StrCpy $1 1
      Delete "$INSTDIR\$2"
      StrCpy $2 ""
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\AciraRemove.exe"
  ${AndIf} $2 == ""
    StrCpy $1 1
  ${EndIf}
  ${If} $1 = 1
    DeleteRegValue SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "QuietUninstallString"
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; --- D141 (22 Nov 2026): an update replaces the old version's files itself, and never starts the old version's remover ---------------------------
; An antivirus (Malwarebytes, "MachineLearning/Anomalous") stopped an Insider's update at the old version's remover: electron-builder copies the
; installed AciraRemove.exe to Temp as old-uninstaller.exe and starts it there, and that program copies the real uninstaller to Temp and starts
; that. Both are small unsigned programs in a random Temp folder, and every Acira on people's disks has them, so no later setup could help by
; being signed. Since this version the setup does that work itself, with its own file and registry commands and no program at all:
;   1. AcOwnReplaceBegin (after Acira is closed): takes the remover's two values out of the registry, so electron-builder's uninstallOldVersion
;      finds none and returns at once, as it has since beta.12 for a damaged remover (AcDropBadUninstaller).
;   2. AcOwnReplaceMove (customUnInstallCheck, after the template has decided about the shortcuts with the old program still in place): the whole
;      install folder is renamed to "<install folder>.old-<number>" beside it. One rename: either the whole old version moved or nothing did, and
;      Windows refuses it while any file in it is open, which is the test that Acira is really closed. Beside the install folder, so it is the
;      same disk whatever disk Temp is on.
;   3. The template installs the new version into the now empty folder: no file of the old version is where anything could load it.
;   4. AcOwnReplaceCheck (first thing in customInstall): the new files are there, or AcOwnReplaceBack puts the old version back.
;   5. AcOwnReplaceDone (last thing in customInstall): the side folder goes.
; Whenever the old version stays or comes back, the registry values are written back and the setup leaves with exit code 2, exactly as it did when
; the old remover failed (customUnInstallCheck). A run that was ended between 2 and 5 (the PC switched off, the setup ended) is put right by the next
; run before anything else (AcOwnReplaceRecover).
; What is touched: the install folder and its "<install folder>.old-<number>" side folder, nothing else. A side folder is only ever removed or
; moved back when it carries this setup's own mark file; a folder of that name that is not ours is skipped and another number is used. Acira's
; data is in the roaming application-data folder, not in the install folder, and no command here names it.
; Not replaced this way, on purpose: a first install (nothing there), a repair of the same version and an install over a damaged remover
; (both as before), and any run with the switch below.
; THE SWITCH BACK (for the Windows laptop, if a step here turns out wrong): the setup argument --acira-old-uninstaller, or the environment
; variable ACIRA_SETUP_OLD_UNINSTALLER=1 (it reaches a setup that the updater starts), or AC_OWN_REPLACE_OFF defined at build time (the next line
; without its semicolon, or ACIRA_BUILD_OWN_REPLACE_OFF=1 in the build's environment): the setup then runs the old version's remover as every
; version before did.
;!define AC_OWN_REPLACE_OFF
; The same switch without touching this file, for a build made again from the same tag: ACIRA_BUILD_OWN_REPLACE_OFF=1 in the environment of
; the build ("$%NAME%" is the build computer's environment, read when the setup is compiled).
!if "$%ACIRA_BUILD_OWN_REPLACE_OFF%" == "1"
  !ifndef AC_OWN_REPLACE_OFF
    !define AC_OWN_REPLACE_OFF
  !endif
!endif
!define AC_OLD_MARK "acira-old-version.txt"
!define AC_OLD_DONE "acira-old-version.done"

; The registry values of the old version's remover (and its version), back as this run found them. Only values this run read are written.
Function AcOwnReplaceRegistryBack
  ${If} $acOldUninstall != ""
    WriteRegStr SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "UninstallString" "$acOldUninstall"
  ${EndIf}
  ${If} $acOldQuiet != ""
    WriteRegStr SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "QuietUninstallString" "$acOldQuiet"
  ${EndIf}
  ${If} $acOldVersion != ""
    WriteRegStr SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "DisplayVersion" "$acOldVersion"
  ${EndIf}
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${If} $acOldUninstall2 != ""
      WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString" "$acOldUninstall2"
    ${EndIf}
    ${If} $acOldQuiet2 != ""
      WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString" "$acOldQuiet2"
    ${EndIf}
  !endif
  ClearErrors
FunctionEnd

; The old version comes back from its side folder ($acOldDir): what the new install had put in the install folder goes, the side folder is
; renamed back, the registry values return. Nothing is removed unless the side folder is there with this setup's mark (a whole old version);
; when Windows will not give the install folder back in five tries, the old version stays in its side folder and the next setup run puts it
; back first (AcOwnReplaceRecover).
Function AcOwnReplaceBack
  Push $0
  StrCmp $acOldDir "" acObLeave
  IfFileExists "$acOldDir\${AC_OLD_MARK}" 0 acObLeave
  ; the setup's own working folder is the install folder by now (SetOutPath): step out of it, or Windows will not let the folder go
  SetOutPath "$PLUGINSDIR"
  StrCpy $0 0
  acObTry:
    IntOp $0 $0 + 1
    RMDir /r "$INSTDIR"
    ClearErrors
    Rename "$acOldDir" "$INSTDIR"
    IfErrors 0 acObBack
    IntCmp $0 5 acObLeave 0 acObLeave
    Sleep 1000
    Goto acObTry
  acObBack:
  Delete "$INSTDIR\${AC_OLD_MARK}"
  StrCpy $acOldDir ""
  SetOutPath "$INSTDIR"
  acObLeave:
  Call AcOwnReplaceRegistryBack
  ClearErrors
  Pop $0
FunctionEnd

; What an earlier run of this setup left beside the install folder, numbers 1 to 9 (a new side folder takes the lowest free number):
; - with the "done" mark: that run finished its install and could not remove all of it (a file held open): it goes;
; - with the first mark: that run was ended before it finished. The side folder is a whole old version (its mark changes before anything in it
;   is removed). If the install folder is whole (the program and its app archive are there) that run got its files in and the side folder is
;   left over; if not, the old version comes back, and this run then updates it.
; A folder with neither mark is not this setup's and is never touched.
Function AcOwnReplaceRecover
  Push $0
  StrCpy $0 0
  acOrrNext:
    IntOp $0 $0 + 1
    IntCmp $0 9 0 0 acOrrEnd
    IfFileExists "$INSTDIR.old-$0\${AC_OLD_DONE}" acOrrLeftOver
    IfFileExists "$INSTDIR.old-$0\${AC_OLD_MARK}" 0 acOrrNext
    IfFileExists "$INSTDIR\${AC_APP_EXE}" 0 acOrrComeBack
    IfFileExists "$INSTDIR\resources\app.asar" 0 acOrrComeBack
    ClearErrors
    Rename "$INSTDIR.old-$0\${AC_OLD_MARK}" "$INSTDIR.old-$0\${AC_OLD_DONE}"
    IfErrors acOrrNext acOrrLeftOver
  acOrrComeBack:
    StrCpy $acOldDir "$INSTDIR.old-$0"
    Call AcOwnReplaceBack
    StrCpy $acOldDir ""
    Goto acOrrNext
  acOrrLeftOver:
    RMDir /r "$INSTDIR.old-$0"
    Goto acOrrNext
  acOrrEnd:
  ClearErrors
  Pop $0
FunctionEnd

; After Acira is closed, before electron-builder looks for the old version's remover. Sets $acOwnReplace to 1 when this run replaces the old files
; itself: an Acira is installed, a remover is registered for it, its version is another than this setup's, and the switch back is not used.
Function AcOwnReplaceBegin
  StrCpy $acOwnReplace 0
  StrCpy $acOldDir ""
  StrCpy $acOldUninstall ""
  StrCpy $acOldQuiet ""
  StrCpy $acOldVersion ""
  StrCpy $acOldUninstall2 ""
  StrCpy $acOldQuiet2 ""
  !ifdef AC_OWN_REPLACE_OFF
    Return
  !endif
  Push $0
  Push $1
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--acira-old-uninstaller" $1
  IfErrors 0 acOrbEnd
  ReadEnvStr $1 "ACIRA_SETUP_OLD_UNINSTALLER"
  ClearErrors
  StrCmp $1 "1" acOrbEnd
  StrCmp $INSTDIR "" acOrbEnd
  Call AcOwnReplaceRecover
  ; a first install: nothing to replace
  IfFileExists "$INSTDIR\${AC_APP_EXE}" 0 acOrbEnd
  ReadRegStr $acOldUninstall SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "UninstallString"
  ReadRegStr $acOldQuiet SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "QuietUninstallString"
  ReadRegStr $acOldVersion SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "DisplayVersion"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ReadRegStr $acOldUninstall2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    ReadRegStr $acOldQuiet2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
  !endif
  ClearErrors
  ; no remover registered (AcDropBadUninstaller just took a damaged one away): the setup installs over the old files, as before
  StrCmp "$acOldUninstall$acOldUninstall2" "" acOrbEnd
  ; a repair of the same version: as before
  StrCmp $acOldVersion "${VERSION}" acOrbEnd
  DeleteRegValue SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "UninstallString"
  DeleteRegValue SHELL_CONTEXT "${AC_OLD_UNINSTALL_KEY}" "QuietUninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
  !endif
  StrCpy $acOwnReplace 1
  acOrbEnd:
  ClearErrors
  Pop $1
  Pop $0
FunctionEnd

; The old version's folder is moved aside in one rename. Error flag set = it could not be (a file in it is still open, no free name, the mark
; could not be written): nothing is moved, the registry values are back, the old version is whole. Clear = $acOldDir names the side folder.
Function AcOwnReplaceMove
  Push $0
  Push $1
  StrCpy $acOldDir ""
  ; the lowest free name: a file or a folder that already has it, ours or not, is not touched here
  StrCpy $0 0
  acOrmName:
    IntOp $0 $0 + 1
    IntCmp $0 99 0 0 acOrmFailed
    IfFileExists "$INSTDIR.old-$0" acOrmName
  ; the setup's own working folder is the install folder (electron-builder's .onInit): Windows will not rename a folder a program is
  ; standing in, so the setup steps out first (the template's SetOutPath $INSTDIR, right after this, makes the new, empty folder)
  SetOutPath "$PLUGINSDIR"
  StrCpy $1 0
  acOrmTry:
    IntOp $1 $1 + 1
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR.old-$0"
    IfErrors 0 acOrmMoved
    IntCmp $1 5 acOrmFailed 0 acOrmFailed
    Sleep 1000
    Goto acOrmTry
  acOrmMoved:
  ; the mark that makes the side folder this setup's own, and a way back for a later run: without it the folder goes straight back
  ClearErrors
  FileOpen $1 "$INSTDIR.old-$0\${AC_OLD_MARK}" w
  IfErrors acOrmUnmarked
  FileWrite $1 "${VERSION}"
  FileClose $1
  StrCpy $acOldDir "$INSTDIR.old-$0"
  ClearErrors
  Pop $1
  Pop $0
  Return
  acOrmUnmarked:
  ClearErrors
  Rename "$INSTDIR.old-$0" "$INSTDIR"
  acOrmFailed:
  Call AcOwnReplaceRegistryBack
  ; the old version stays: the working folder is its folder again, as it was (the old Acira that Install now reopens starts from it)
  IfFileExists "$INSTDIR\${AC_APP_EXE}" 0 acOrmOut
  SetOutPath "$INSTDIR"
  acOrmOut:
  Pop $1
  Pop $0
  SetErrors
FunctionEnd

; First thing after the new files are written. Error flag set = they are not all there (the program or its app archive is missing) and the old
; version was put back; clear = the new version is in place (or this run moved nothing).
Function AcOwnReplaceCheck
  ClearErrors
  StrCmp $acOldDir "" acOrcEnd
  IfFileExists "$INSTDIR\${AC_APP_EXE}" 0 acOrcBack
  IfFileExists "$INSTDIR\resources\app.asar" acOrcEnd
  acOrcBack:
  Call AcOwnReplaceBack
  SetErrors
  acOrcEnd:
FunctionEnd

; Last thing of a finished install: the side folder goes. Its mark changes first, so a folder that is being removed is never taken for a whole
; old version; if the mark cannot be changed nothing is removed (the next run decides, AcOwnReplaceRecover).
Function AcOwnReplaceDone
  StrCmp $acOldDir "" acOrdEnd
  ClearErrors
  Rename "$acOldDir\${AC_OLD_MARK}" "$acOldDir\${AC_OLD_DONE}"
  IfErrors acOrdEnd
  RMDir /r "$acOldDir"
  acOrdEnd:
  StrCpy $acOldDir ""
  ClearErrors
FunctionEnd

; Takes a string off the stack; leaves its first run of digits on top ("" when it has none) and what follows that run below it.
Function AcNextNumber
  Exch $0
  Push $1
  Push $2
  Push $3
  StrCpy $2 ""
  acNnNext:
    StrCpy $1 $0 1
    StrCmp $1 "" acNnEnd
    ; a digit reads back as itself, anything else as 0
    IntOp $3 $1 + 0
    StrCmp $3 $1 0 acNnOther
    StrCpy $2 "$2$1"
    StrCpy $0 $0 "" 1
    Goto acNnNext
  acNnOther:
    StrCmp $2 "" 0 acNnEnd
    StrCpy $0 $0 "" 1
    Goto acNnNext
  acNnEnd:
  StrCpy $1 $2
  Pop $3
  Pop $2
  Exch $1
  Exch
  Exch $0
  Exch
FunctionEnd

; Push A, push B, call: 1 on the stack when version A is newer than version B, else 0. The numbers in each are compared in order
; ("0.1.0-beta.14.1" is 0, 1, 0, 14, 1), and a version that goes on where the other ends is the newer one (14.1 over 14). Enough for Acira's
; beta versions; the question card (AciraChoose.cs) has the full rule and is what people normally get.
Function AcVersionNewer
  Exch $1
  Exch
  Exch $0
  Push $2
  Push $3
  Push $4
  StrCpy $4 0
  acVnNext:
    Push $0
    Call AcNextNumber
    Pop $2
    Pop $0
    Push $1
    Call AcNextNumber
    Pop $3
    Pop $1
    StrCmp $2 "" acVnEnd
    StrCmp $3 "" acVnNewer
    IntCmp $2 $3 acVnNext acVnEnd acVnNewer
  acVnNewer:
  StrCpy $4 1
  acVnEnd:
  StrCpy $0 $4
  Pop $4
  Pop $3
  Pop $2
  Exch
  Pop $1
  Exch $0
FunctionEnd
!endif

; Acira-owned per-user capabilities only. Windows chooses defaults through its UI.
!macro customInstall
  !ifndef BUILD_UNINSTALLER
    ; D141: the new files are written. If this run moved the old version aside and the new one is not all there, the old one is back by now
    ; and the setup leaves as it does when the old version could not be removed.
    Call AcOwnReplaceCheck
    ${If} ${Errors}
      StrCpy $R0 2
      DetailPrint `The new files are incomplete: the previous version was put back.`
      !insertmacro AcLeaveWithOldVersion
    ${EndIf}
    Call AcStage2
    ; Branded uninstall question for Settings > Apps. QuietUninstallString stays the real uninstaller, and the launcher hands any /S run
    ; (the updater removing the previous version) straight to the real uninstaller, so silent paths never see a window.
    File "/oname=$INSTDIR\AciraRemove.exe" "${BUILD_RESOURCES_DIR}\installer\acira-uninstall.exe"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\AciraRemove.exe" /currentuser'
    ; Settings > Apps shows DisplayVersion. electron-builder writes it from ${VERSION} (registryAddInstallInfo), but a beta.12 install showed 0.1.0-beta.6 after updates, so it is written
    ; again here, last, for EVERY install (an update included): in the key this setup writes, and in the current-user key of an earlier install when that is another key.
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION}"
    Push $R0
    ReadRegStr $R0 HKCU "${AC_OLD_UNINSTALL_KEY}" "DisplayName"
    ${If} $R0 != ""
      WriteRegStr HKCU "${AC_OLD_UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
    ${EndIf}
    Pop $R0
  !endif
  WriteRegStr HKCU "${AC_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${AC_REG_KEY}\Capabilities" "ApplicationName" "${AC_REG_APP}"
  WriteRegStr HKCU "${AC_REG_KEY}\Capabilities" "ApplicationDescription" "An independent local web browser."
  WriteRegStr HKCU "${AC_REG_KEY}\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${AC_APP_EXE}$\",0'
  WriteRegStr HKCU "${AC_REG_KEY}\Capabilities\URLAssociations" "http" "${AC_PROGID}"
  WriteRegStr HKCU "${AC_REG_KEY}\Capabilities\URLAssociations" "https" "${AC_PROGID}"
  WriteRegStr HKCU "Software\RegisteredApplications" "${AC_REG_APP}" "${AC_REG_KEY}\Capabilities"
  WriteRegStr HKCU "Software\Classes\${AC_PROGID}" "" "${AC_REG_APP} URL"
  WriteRegStr HKCU "Software\Classes\${AC_PROGID}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${AC_PROGID}\DefaultIcon" "" '$\"$INSTDIR\${AC_APP_EXE}$\",0'
  WriteRegStr HKCU "Software\Classes\${AC_PROGID}\shell\open\command" "" '$\"$INSTDIR\${AC_APP_EXE}$\" $\"%1$\"'
  !ifndef ACIRA_QA
    ; acira:// (the personal Insider link acira://insider/activate?t=...): Windows starts Acira with the link in its command line, or hands it to the running Acira as a second
    ; instance (desktop/insider/insider-link.cjs). 17 Nov: it was never registered, so a link clicked outside Acira went nowhere. The real Acira only: a QA install never writes its keys.
    WriteRegStr HKCU "Software\Classes\acira" "" "URL:Acira link"
    WriteRegStr HKCU "Software\Classes\acira" "URL Protocol" ""
    WriteRegStr HKCU "Software\Classes\acira\DefaultIcon" "" '$\"$INSTDIR\${AC_APP_EXE}$\",0'
    WriteRegStr HKCU "Software\Classes\acira\shell\open\command" "" '$\"$INSTDIR\${AC_APP_EXE}$\" $\"%1$\"'
  !endif
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  !ifndef BUILD_UNINSTALLER
    ; D141: the install is finished: the old version's side folder goes
    Call AcOwnReplaceDone
  !endif
!macroend

; Uninstaller: a short branded splash (not when run silently, e.g. by the updater), then an optional data removal question.
!macro customUnInit
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
    ; the splash picture carries English text: other languages skip it (the branded launcher AciraRemove.exe is what people normally see, in their language)
    ReadEnvStr $R3 ACIRA_INSTALLER_LANG
    ${If} $R3 == ""
      System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
      IntOp $R4 $0 & 0x3ff
      StrCpy $R3 "en"
      ${If} $R4 = 10
      ${OrIf} $R4 = 12
      ${OrIf} $R4 = 7
      ${OrIf} $R4 = 22
      ${OrIf} $R4 = 16
      ${OrIf} $R4 = 17
      ${OrIf} $0 = 2052
      ${OrIf} $0 = 4100
        StrCpy $R3 "other"
      ${EndIf}
    ${EndIf}
    ${If} $R3 == "en"
      InitPluginsDir
      ; the same picture size as the setup window on this screen: AcStyleBanner's choice (125% and up -> 150, 175% and up -> 200)
      Push $R5
      Push $R6
      System::Call 'user32::GetDC(p 0) p .R6'
      System::Call 'gdi32::GetDeviceCaps(p R6, i 88) i .R5'
      System::Call 'user32::ReleaseDC(p 0, p R6)'
      ${If} $R5 < 96
        StrCpy $R5 96
      ${EndIf}
      IntOp $R5 $R5 * 100
      IntOp $R5 $R5 / 96
      ${If} $R5 >= 175
        File "/oname=$PLUGINSDIR\ac-un-dark.bmp" "${BUILD_RESOURCES_DIR}\installer\uninstall-dark-200.bmp"
      ${ElseIf} $R5 >= 125
        File "/oname=$PLUGINSDIR\ac-un-dark.bmp" "${BUILD_RESOURCES_DIR}\installer\uninstall-dark-150.bmp"
      ${Else}
        File "/oname=$PLUGINSDIR\ac-un-dark.bmp" "${BUILD_RESOURCES_DIR}\installer\uninstall-dark-100.bmp"
      ${EndIf}
      Pop $R6
      Pop $R5
      StrCpy $R2 "ac-un-dark"
      advsplash::show 1600 200 300 -1 "$PLUGINSDIR\$R2"
      Pop $R1
    ${EndIf}
  ${EndIf}
!macroend

; Defer plugin-using function compilation until electron-builder has registered its plugin paths.
!macro customHeader
!ifdef BUILD_UNINSTALLER
!include "FileFunc.nsh"
; Anonymous usage, beta.9 (docs/launch/METRICS.md, "Who stops using Acira"): when a person really uninstalls Acira, one last message says
; so, only while their usage sharing is on. (A Mac cannot do this: an app dragged to the Trash runs nothing.)
; - Never on an update. The new version's installer runs this uninstaller with --updated (or --delete-app-data) and always with
;   /KEEP_APP_DATA (electron-builder's installUtil.nsh, uninstallOldVersion): the updater, the branded Repair or Update, and a new setup
;   run over Acira all go that way, and either flag stops it here. A person's own uninstall (Settings > Apps, which opens AciraRemove.exe,
;   or a silent /S run) has neither.
; - Only while sharing is on: the profile's metrics.json must start with {"choice":"on","installId":"<random id>","route":"ok" (the app
;   writes those three keys first: desktop/browser-services/metrics.cjs). Turning sharing off deletes the id. "route":"ok" means the app's
;   last check found its normal connection, the rule that lets the daily message leave, so this never goes around a manual proxy either.
; - It runs before any file or data is removed, so "Remove and delete my data" still deletes after it.
; - One HTTPS POST of the same fields the app shows in "See what's sent", through Windows' own WinHTTP with the system proxy settings, the
;   app's User-Agent (Acira/<version>), no cookies, no redirects, no sign-in, no keep-alive. Each step has a short limit (name lookup 1 s,
;   connection 1 s, sending 1 s, answer 1.5 s), so it can never hold the uninstall up for more than a few seconds; offline it fails at once.
;   No retry, the answer is not read, nothing is written to disk or the registry, and whatever happens the uninstall goes on.
; - The optional one-tap reason (Beta 14, the plan): the branded remover (packaging/installer/AciraUninstall.cs, the card people see from Settings > Apps) asks
;   "Why are you removing Acira?" before it removes anything, and only while sharing is on, and runs this uninstaller with /ACIRA_REASON=<word> after a tap.
;   Exactly one of the seven words the usage function accepts goes into the message (schema 4 adds `reason`); anything else, or Skip (no option at all), sends
;   the message as before (schema 1, no reason). The card does no network work: the only wait is the one POST above, with the same short limits.
Function un.AcUsageUninstalled
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R8
  Push $R9
  ; an update, or a setup run over this version, is not an uninstall (${isUpdated} reads --updated; it uses $R9)
  ${If} ${isUpdated}
    Goto acUsageDone
  ${EndIf}
  ${GetParameters} $0
  ${GetOptions} $0 "/KEEP_APP_DATA" $1
  ${IfNot} ${Errors}
    Goto acUsageDone
  ${EndIf}
  StrCmp "${AC_USAGE_HOST}" "" acUsageDone
  ClearErrors
  FileOpen $1 "$APPDATA\${AC_DATA_DIR}\metrics.json" r
  IfErrors acUsageDone
  FileRead $1 $2
  FileClose $1
  ; $2 = the start of the file. Sharing on, then the 36-character random id, then the route note.
  StrCpy $3 $2 28
  StrCmpS $3 '{"choice":"on","installId":"' 0 acUsageDone
  StrCpy $3 $2 14 64
  StrCmpS $3 '","route":"ok"' 0 acUsageDone
  StrCpy $3 $2 36 28
  ; only 0-9, a-f and - can go into the message
  StrCpy $5 0
  acUsageIdChar:
    StrCpy $6 $3 1 $5
    StrCmp $6 "" acUsageIdEnd
    StrCpy $7 0
    acUsageIdFind:
      StrCpy $8 "0123456789abcdef-" 1 $7
      StrCmp $8 "" acUsageDone
      StrCmpS $8 $6 acUsageIdNext
      IntOp $7 $7 + 1
      Goto acUsageIdFind
    acUsageIdNext:
    IntOp $5 $5 + 1
    Goto acUsageIdChar
  acUsageIdEnd:
  IntCmp $5 36 0 acUsageDone acUsageDone
  ; today's UTC date, no time: SYSTEMTIME is wYear, wMonth, wDayOfWeek, wDay, ...
  System::Alloc 16
  Pop $1
  StrCmp $1 0 acUsageDone
  System::Call 'kernel32::GetSystemTime(p r1)'
  System::Call '*$1(&i2 .r4, &i2 .r5, &i2, &i2 .r6)'
  System::Free $1
  IntFmt $5 "%02u" $5
  IntFmt $6 "%02u" $6
  StrCpy $4 "$4-$5-$6"
  ; the reason the person tapped on the remover's card, if any: only one of the seven closed words (the same list as UNINSTALL_REASONS in the usage function), else none
  ${GetParameters} $0
  ${GetOptions} $0 "/ACIRA_REASON=" $R8
  ${If} ${Errors}
    StrCpy $R8 ""
  ${EndIf}
  ClearErrors
  StrCmpS $R8 "slow" acReasonKnown
  StrCmpS $R8 "crashes" acReasonKnown
  StrCmpS $R8 "missing-feature" acReasonKnown
  StrCmpS $R8 "not-clear" acReasonKnown
  StrCmpS $R8 "switched-back" acReasonKnown
  StrCmpS $R8 "just-trying" acReasonKnown
  StrCmpS $R8 "other" acReasonKnown
  StrCpy $R8 ""
  acReasonKnown:
  StrCmp $R8 "" acUsageNoReason
  StrCpy $5 '{"schema":4,"event":"uninstall","installId":"$3","appVersion":"${VERSION}","platform":"win32","arch":"${AC_USAGE_ARCH}","day":"$4","reason":"$R8"}'
  Goto acUsageBuilt
  acUsageNoReason:
  StrCpy $5 '{"schema":1,"event":"uninstall","installId":"$3","appVersion":"${VERSION}","platform":"win32","arch":"${AC_USAGE_ARCH}","day":"$4"}'
  acUsageBuilt:
  StrLen $6 $5
  StrCpy $7 0
  StrCpy $8 0
  StrCpy $9 0
  ; WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY (4): the system's proxy settings, as Acira's own "system" route
  System::Call 'winhttp::WinHttpOpen(w "Acira/${VERSION}", i 4, p 0, p 0, i 0) p .r7'
  ${If} $7 <> 0
    System::Call 'winhttp::WinHttpSetTimeouts(p r7, i 1000, i 1000, i 1000, i 1500) i'
    System::Call 'winhttp::WinHttpConnect(p r7, w "${AC_USAGE_HOST}", i 443, i 0) p .r8'
  ${EndIf}
  ${If} $8 <> 0
    ; WINHTTP_FLAG_SECURE (0x00800000): https only
    System::Call 'winhttp::WinHttpOpenRequest(p r8, w "POST", w "${AC_USAGE_PATH}", p 0, p 0, p 0, i 0x00800000) p .r9'
  ${EndIf}
  ${If} $9 <> 0
    ; WINHTTP_OPTION_DISABLE_FEATURE (63): no cookies (1), no redirects (2), no sign-in (4), no keep-alive (8)
    System::Call 'winhttp::WinHttpSetOption(p r9, i 63, *i 15, i 4) i'
    ; the body is ASCII only (checked id, version, fixed words, date), sent as bytes
    System::Call 'winhttp::WinHttpSendRequest(p r9, w "Content-Type: application/json", i -1, m r5, i r6, i r6, p 0) i .r1'
    ${If} $1 <> 0
      System::Call 'winhttp::WinHttpReceiveResponse(p r9, p 0) i'
    ${EndIf}
    System::Call 'winhttp::WinHttpCloseHandle(p r9) i'
  ${EndIf}
  ${If} $8 <> 0
    System::Call 'winhttp::WinHttpCloseHandle(p r8) i'
  ${EndIf}
  ${If} $7 <> 0
    System::Call 'winhttp::WinHttpCloseHandle(p r7) i'
  ${EndIf}
  acUsageDone:
  ClearErrors
  Pop $R9
  Pop $R8
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif
!macroend

!macro customUnInstall
  ; first, before anything is removed: the one usage message, if this is a real uninstall and sharing is on (see un.AcUsageUninstalled)
  Call un.AcUsageUninstalled
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
    ReadEnvStr $R3 ACIRA_INSTALLER_LANG
    ${If} $R3 == ""
      System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
      IntOp $R4 $0 & 0x3ff
      ${If} $R4 = 10
        StrCpy $R3 "es"
      ${ElseIf} $R4 = 12
        StrCpy $R3 "fr"
      ${ElseIf} $R4 = 7
        StrCpy $R3 "de"
      ${ElseIf} $R4 = 22
        StrCpy $R3 "pt"
      ${ElseIf} $R4 = 16
        StrCpy $R3 "it"
      ${ElseIf} $R4 = 17
        StrCpy $R3 "ja"
      ${ElseIf} $0 = 2052
        StrCpy $R3 "zh"
      ${ElseIf} $0 = 4100
        StrCpy $R3 "zh"
      ${Else}
        StrCpy $R3 "en"
      ${EndIf}
    ${EndIf}
    ${If} $R3 == "es"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Borrar también tus datos de Acira en este equipo (perfiles, marcadores, historial, inicios de sesión guardados)?$\n$\nElige No para conservarlos para una futura instalación." IDNO acKeepData
    ${ElseIf} $R3 == "fr"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Supprimer aussi vos données Acira sur ce PC (profils, favoris, historique, connexions enregistrées) ?$\n$\nChoisissez Non pour les conserver pour une future installation." IDNO acKeepData
    ${ElseIf} $R3 == "de"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Auch deine Acira-Daten auf diesem PC löschen (Profile, Lesezeichen, Verlauf, gespeicherte Anmeldungen)?$\n$\nWähle Nein, um sie für eine spätere Installation zu behalten." IDNO acKeepData
    ${ElseIf} $R3 == "pt"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Apagar também seus dados do Acira neste computador (perfis, favoritos, histórico, logins salvos)?$\n$\nEscolha Não para mantê-los para uma instalação futura." IDNO acKeepData
    ${ElseIf} $R3 == "it"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Eliminare anche i tuoi dati di Acira su questo PC (profili, segnalibri, cronologia, accessi salvati)?$\n$\nScegli No per conservarli per una futura installazione." IDNO acKeepData
    ${ElseIf} $R3 == "ja"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "このパソコン上の Acira のデータ（プロファイル、ブックマーク、履歴、保存済みのサインイン情報）も削除しますか？$\n$\n今後の再インストールのために残す場合は「いいえ」を選んでください。" IDNO acKeepData
    ${ElseIf} $R3 == "zh"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除这台电脑上的 Acira 数据（配置文件、书签、历史记录、已保存的登录信息）？$\n$\n选择“否”可保留数据，以便将来重新安装。" IDNO acKeepData
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Acira data on this PC (profiles, bookmarks, history, saved sign-ins)?$\n$\nChoose No to keep it for a future install." IDNO acKeepData
    ${EndIf}
    RMDir /r "$APPDATA\${AC_DATA_DIR}"
    ; Beta 14 (brief B9, accurate counts): "delete my data" leaves one yes/no marker for this Windows account, "Acira was installed here before": no id, no date, no version. The app reads it on its next
    ; first-ever message and says `returning`, so a wipe and reinstall is counted as a returning install, not as a new person. Listed on acira://usage.
    WriteRegDWORD HKCU "${AC_RETURN_KEY}" "InstalledBefore" 1
    acKeepData:
  ${EndIf}
  ReadRegStr $R0 HKCU "${AC_REG_KEY}" "InstallLocation"
  ${If} $R0 == $INSTDIR
    DeleteRegValue HKCU "Software\RegisteredApplications" "${AC_REG_APP}"
    DeleteRegKey HKCU "Software\Classes\${AC_PROGID}"
    !ifndef ACIRA_QA
      DeleteRegKey HKCU "Software\Classes\acira"
    !endif
    DeleteRegKey HKCU "${AC_REG_KEY}"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
; electron-builder's handleUninstallResult shows a plain OK box ("Failed to uninstall old application files", no silent default) when the old
; version's files could not be removed (a locked file, antivirus). Only a person who started setup themselves gets it. The updater's runs (/S, and
; --updated without /S from Install now on beta.8 and earlier) leave with exit code 2; the old version is untouched (its uninstaller removes
; atomically). Install now (--force-run) opens that old version again, so nobody is left with a closed browser; its updater still holds the
; download. Labels come from LogicLib: the macro is inserted for both registry roots.
!macro customUnInstallCheck
  ; D141: this run replaces the old files itself (AcOwnReplaceBegin took the remover out of the registry, so none was started and $R0 is 0).
  ; The move comes here, after the template has decided about the shortcuts with the old program still in place. It is tried once: the macro
  ; is inserted for both registry roots.
  ${If} $acOwnReplace = 1
    StrCpy $acOwnReplace 2
    Call AcOwnReplaceMove
    ${If} ${Errors}
      StrCpy $R0 2
    ${Else}
      StrCpy $R0 0
    ${EndIf}
    ClearErrors
  ${EndIf}
  ${IfNot} ${Errors}
  ${AndIf} $R0 != 0
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    !insertmacro AcLeaveWithOldVersion
  ${EndIf}
!macroend
; AcLeaveWithOldVersion: the setup ends with the old version in place (exit code 2). Used when the old version's remover failed (above) and,
; D141, when this setup's own replacement could not move the old files or found the new ones incomplete and put the old version back.
!macro AcLeaveWithOldVersion
    Push $R1
    Push $R2
    ${GetParameters} $R1
    ClearErrors
    ${GetOptions} $R1 "--updated" $R2
    ${If} ${Errors}
    ${AndIfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    ${EndIf}
    ClearErrors
    ${GetOptions} $R1 "--force-run" $R2
    ${IfNot} ${Errors}
      Exec '"$INSTDIR\${AC_APP_EXE}"'
    ${EndIf}
    Pop $R2
    Pop $R1
    SetErrorLevel 2
    Quit
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
!endif
