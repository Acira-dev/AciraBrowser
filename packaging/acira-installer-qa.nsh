; QA identity installer script (node scripts/release.mjs --qa-identity; packaging/signing-config.cjs points nsis.include here).
; The same installer as acira-installer.nsh with its own registry keys, registration, URL ProgID and data folder, so a QA install or
; uninstall on a PC that also has the real Acira never touches the real one.
!define ACIRA_QA
!include "acira-installer.nsh"
