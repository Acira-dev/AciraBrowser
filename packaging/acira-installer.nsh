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
!else
  !define AC_REG_KEY "Software\AciraBrowser"
  !define AC_REG_APP "Acira Browser"
  !define AC_PROGID "AciraBrowser.Url"
  !define AC_DATA_DIR "AciraBrowser"
  !define AC_APP_EXE "AciraBrowser.exe"
!endif
;
; Where the Windows uninstaller sends its one usage message (Acira's usage function: desktop/browser-services/metrics-config.cjs has the same
; address, and tests/usage-uninstall.test.cjs keeps the two equal). A QA build never sends it: QA rigs install and remove that build many
; times, and none of that is a person leaving.
!ifdef ACIRA_QA
  !define AC_USAGE_HOST ""
!else
  !define AC_USAGE_HOST "kqioquxkyprnaupqocnx.supabase.co"
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
  Exec '"$PLUGINSDIR\acira-progress.exe" $acWnd $acTheme $acScale "$PLUGINSDIR\ac-done.flag" "$INSTDIR" ${ESTIMATED_SIZE} "$PLUGINSDIR\app-64.7z" "$EXEPATH"'
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

; The one-click installer shows a small banner window; restyle it as soon as it exists, then run the standard running-app check.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; silent runs (the updater) show nothing
    IfSilent acNoBanner
    Call AcStyleBanner
    acNoBanner:
    ; before electron-builder runs the old version's uninstaller (uninstallOldVersion comes right after this check)
    Call AcDropBadUninstaller
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !ifndef BUILD_UNINSTALLER
    ; electron-builder's stock check puts the install folder inside a PowerShell single-quoted string (StartsWith('$INSTDIR', ...)). A single or typographic
    ; quote in it (a Windows user named O'Brien, Ma'ruf, Ra’ed) ends that string early, PowerShell cannot parse the line and exits 1, which the check reads
    ; as "Acira is not running": the old Acira is neither waited for nor closed, the old files are in use and the update does not take. With such a folder
    ; the PowerShell way is off ($IsPowerShellAvailable: 0 = available) and the stock macros take their tasklist / taskkill branch, which names the program
    ; (AciraBrowser.exe, this user's) and never puts the folder in a command.
    Call AcQuoteInInstdir
    Pop $0
    ${If} $0 = 1
      StrCpy $IsPowerShellAvailable 1
    ${EndIf}
  !endif
  !insertmacro _CHECK_APP_RUNNING
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
  Exec '"$PLUGINSDIR\acira-choose.exe" --choose "$INSTDIR" "${VERSION}" "$PLUGINSDIR\ac-choice.txt"'
  ; Wait for the answer. The question stays up until the installer's own card covers it, so the answer comes first and the window
  ; leaves later. If the window was seen and is gone without an answer, that is Cancel; if it never shows in 10 s, install as before.
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
      Goto acAskGo
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
!endif

; Acira-owned per-user capabilities only. Windows chooses defaults through its UI.
!macro customInstall
  !ifndef BUILD_UNINSTALLER
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
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
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
  StrCpy $5 '{"schema":1,"event":"uninstall","installId":"$3","appVersion":"${VERSION}","platform":"win32","arch":"${AC_USAGE_ARCH}","day":"$4"}'
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
    acKeepData:
  ${EndIf}
  ReadRegStr $R0 HKCU "${AC_REG_KEY}" "InstallLocation"
  ${If} $R0 == $INSTDIR
    DeleteRegValue HKCU "Software\RegisteredApplications" "${AC_REG_APP}"
    DeleteRegKey HKCU "Software\Classes\${AC_PROGID}"
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
  ${IfNot} ${Errors}
  ${AndIf} $R0 != 0
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
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
  ${EndIf}
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
!endif
