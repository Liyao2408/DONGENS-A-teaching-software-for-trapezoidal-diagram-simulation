; Dongens Semi Integrated N26 (DSI Platform) 安装包脚本
Unicode true

!include "MUI2.nsh"

!define APPNAME "DONGENS"
!define APPEXE "Dongens Semi Integrated N26.exe"
!define SHORTNAME "Dongens Semi Integrated N26"
!define COMPANY "Dongens Semi"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DONGENS"

Name "${SHORTNAME}"
OutFile "C:\Users\yulih\WorkBuddy\2026-11-23-18-00-10\DSI-Platform-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "C:\Users\yulih\WorkBuddy\2026-11-23-18-00-10\logo.ico"
!define MUI_UNICON "C:\Users\yulih\WorkBuddy\2026-11-23-18-00-10\logo.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "安装"
  SetOutPath "$INSTDIR"

  ; 拷贝程序文件（排除备份 asar 和旧卸载器）
  File /r /x "app.asar.bak*" /x "Uninstall *.exe" /x "DSI-Platform-Setup.exe" "D:\个人\桌面\模型\1tia-sim\*.*"

  ; 卸载器
  WriteUninstaller "$INSTDIR\Uninstall ${APPNAME}.exe"

  ; 开始菜单快捷方式（显示名为 Dongens Semi Integrated N26）
  CreateDirectory "$SMPROGRAMS\${SHORTNAME}"
  CreateShortcut "$SMPROGRAMS\${SHORTNAME}\${SHORTNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateShortcut "$SMPROGRAMS\${SHORTNAME}\卸载.lnk" "$INSTDIR\Uninstall ${APPNAME}.exe"

  ; 桌面快捷方式
  CreateShortcut "$DESKTOP\${SHORTNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0

  ; 注册卸载信息（出现在 Windows「卸载程序」列表）
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${SHORTNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$INSTDIR\Uninstall ${APPNAME}.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${SHORTNAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTNAME}\*.*"
  RMDir "$SMPROGRAMS\${SHORTNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"
SectionEnd
