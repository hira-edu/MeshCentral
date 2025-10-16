
!include "MUI2.nsh"
!include "LogicLib.nsh"
Var UseProxy

Name "MeshAgent (Custom)"
OutFile "meshagent_custom_setup.exe"
InstallDir "C:/ProgramData/Acme/TelemetryCore"
RequestExecutionLevel admin

Section "Use Proxy" SEC_PROXY
  StrCpy $UseProxy "1"
SectionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File /oname=AcmeTelemetryCore.exe "C:/Users/Workstation 1/Documents/GitHub/MeshCentral/custom_meshagent/build/meshagent/output/staging/AcmeTelemetryCore.exe"
  File "C:/Users/Workstation 1/Documents/GitHub/MeshCentral/custom_meshagent/build/meshagent/output/staging/meshagent.msh"
  File "C:/Users/Workstation 1/Documents/GitHub/MeshCentral/custom_meshagent/build/meshagent/output/staging/install.ps1"
  ${If} \$UseProxy == '1'
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -File ""$INSTDIR\install.ps1"" -SourceDir ""$INSTDIR"" -UseProxy"
  ${Else}
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -File ""$INSTDIR\install.ps1"" -SourceDir ""$INSTDIR"""
  ${End}
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'sc.exe stop "AcmeTelemetryCore"'
  nsExec::ExecToLog 'sc.exe delete "AcmeTelemetryCore"'
  RMDir /r "$INSTDIR"
SectionEnd
