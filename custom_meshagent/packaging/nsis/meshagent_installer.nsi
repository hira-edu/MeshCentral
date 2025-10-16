; Minimal NSIS stub for MeshAgent packaging (branding-aware via staged bundle)
; This is a placeholder aligned with the build plan. It expects a bundle
; staged by the packaging step containing the binary (renamed) and meshagent.msh.

!include "MUI2.nsh"

Name "MeshAgent (Custom)"
OutFile "meshagent_custom_setup.exe"
InstallDir "$PROGRAMFILES\MeshAgentCustom"
RequestExecutionLevel admin

Section "Install"
  SetOutPath "$INSTDIR"
  ; In a real pipeline, copy from a known bundle path or embed files.
  ; For now, this is a placeholder. The PowerShell bootstrap is preferred
  ; to drive install (service registration) using sc.exe.
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
SectionEnd

