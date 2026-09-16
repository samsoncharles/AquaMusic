; AquaMusic NSIS Installer Script
; Modern, Offline, Fully Self-Contained Windows Setup

Unicode True
RequestExecutionLevel user

!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "AquaMusic"
OutFile "..\release\AquaMusic-1.0.1-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\AquaMusic"
InstallDirRegKey HKCU "Software\AquaMusic" "InstallDir"

; Interface Settings
!define MUI_ABORTWARNING
!define MUI_ICON "aquamusic.ico"
!define MUI_UNICON "aquamusic.ico"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\AquaMusic.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch AquaMusic now"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "AquaMusic (required)" SecMain
    SectionIn RO

    SetOutPath "$INSTDIR"
    File /r "..\build\win_pkg\AquaMusic\*"

    ; Ensure Working Directory for all shortcuts is $INSTDIR
    SetOutPath "$INSTDIR"

    ; Create Desktop Shortcut
    CreateShortcut "$DESKTOP\AquaMusic.lnk" "$INSTDIR\AquaMusic.exe" "" "$INSTDIR\AquaMusic.exe" 0

    ; Create Start Menu Shortcuts
    CreateDirectory "$SMPROGRAMS\AquaMusic"
    CreateShortcut "$SMPROGRAMS\AquaMusic\AquaMusic.lnk" "$INSTDIR\AquaMusic.exe" "" "$INSTDIR\AquaMusic.exe" 0
    CreateShortcut "$SMPROGRAMS\AquaMusic\Uninstall AquaMusic.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0

    ; Write Uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Windows Add/Remove Programs Registry
    WriteRegStr HKCU "Software\AquaMusic" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "DisplayName" "AquaMusic"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "DisplayVersion" "1.0.1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "DisplayIcon" "$INSTDIR\AquaMusic.exe,0"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "Publisher" "AquaMusic Team"
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic" "NoRepair" 1
SectionEnd

Section "Uninstall"
    ; Remove Shortcuts
    Delete "$DESKTOP\AquaMusic.lnk"
    Delete "$SMPROGRAMS\AquaMusic\AquaMusic.lnk"
    Delete "$SMPROGRAMS\AquaMusic\Uninstall AquaMusic.lnk"
    RMDir "$SMPROGRAMS\AquaMusic"

    ; Remove Registry
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMusic"
    DeleteRegKey HKCU "Software\AquaMusic"

    ; Remove Files
    RMDir /r "$INSTDIR"
SectionEnd

