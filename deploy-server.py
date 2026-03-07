#!/usr/bin/env python3
"""
MeshCentral Server Deployment Tool
====================================
End-to-end management for MeshCentral server code: views, modules, custom scripts,
config, npm updates, and full server lifecycle.

Usage:
    python deploy-server.py status               - Server version, service, customizations
    python deploy-server.py pull                  - Pull current server files to local working copy
    python deploy-server.py push [--file FILE]    - Push local changes to server (with backup + restart)
    python deploy-server.py push --dry-run        - Show what would be pushed without doing it
    python deploy-server.py diff                  - Diff local vs server files
    python deploy-server.py update                - npm update meshcentral on server (with backup)
    python deploy-server.py rollback              - Restore from server backup
    python deploy-server.py config                - View server config
    python deploy-server.py config edit           - Edit server config locally then push
    python deploy-server.py logs [N]              - Tail MeshCentral logs
    python deploy-server.py health                - Full health check
    python deploy-server.py ssh <command>         - Run arbitrary command on server
    python deploy-server.py vscode                - Open VS Code Remote-SSH to server
"""

import argparse
import difflib
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ─── Configuration ────────────────────────────────────────────────────────────

SERVER = "meshcentral"  # SSH config alias (resolves to 167.88.44.65)
SERVER_IP = "167.88.44.65"

# Remote paths
MC_BASE = "/opt/meshcentral"
MC_MODULE = f"{MC_BASE}/node_modules/meshcentral"
MC_DATA = f"{MC_BASE}/meshcentral-data"
MC_WEB = f"{MC_BASE}/meshcentral-web"
MC_CONFIG = f"{MC_DATA}/config.json"
MC_BACKUP = f"{MC_BASE}/server-backups"
SERVICE_NAME = "meshcentral"

# Local repo root (MeshCentral clone mirrors server module structure)
LOCAL_REPO = Path(__file__).parent.resolve()
LOCAL_SERVER = LOCAL_REPO  # Repo root IS the working copy

# File mapping: local relative path (in repo) → remote absolute path (on server)
# Add entries here as you customize more server files
FILE_MAP = {
    # Custom web overlay (lives outside the npm module on server)
    "public/scripts/custom.js": f"{MC_WEB}/public/scripts/custom.js",

    # Live core overrides in meshcentral-data
    "meshcentral-data/meshcore.js": f"{MC_DATA}/meshcore.js",

    # Views (handlebars templates)
    "views/default.handlebars": f"{MC_MODULE}/views/default.handlebars",
    "views/default-mobile.handlebars": f"{MC_MODULE}/views/default-mobile.handlebars",
    "views/default3.handlebars": f"{MC_MODULE}/views/default3.handlebars",
    "views/agentinvite.handlebars": f"{MC_MODULE}/views/agentinvite.handlebars",
    "views/login.handlebars": f"{MC_MODULE}/views/login.handlebars",
    "views/login2.handlebars": f"{MC_MODULE}/views/login2.handlebars",
    "views/sharing.handlebars": f"{MC_MODULE}/views/sharing.handlebars",
    "views/messenger.handlebars": f"{MC_MODULE}/views/messenger.handlebars",

    # Stylesheets
    "public/styles/style-bootstrap.css": f"{MC_MODULE}/public/styles/style-bootstrap.css",
    "public/styles/style.css": f"{MC_MODULE}/public/styles/style.css",

    # Agent cores served to clients
    "agents/meshcore.js": f"{MC_MODULE}/agents/meshcore.js",
    "agents/meshcore_diagnostic.js": f"{MC_MODULE}/agents/meshcore_diagnostic.js",
    "agents/recoverycore.js": f"{MC_MODULE}/agents/recoverycore.js",
    "agents/agentrecoverycore.js": f"{MC_MODULE}/agents/agentrecoverycore.js",

    # MeshCentral startup core assembly logic
    "meshcentral.js": f"{MC_MODULE}/meshcentral.js",

    # Server modules
    "meshdevicefile.js": f"{MC_MODULE}/meshdevicefile.js",
    "meshagent.js": f"{MC_MODULE}/meshagent.js",

    # Config (stored in meshcentral-data/ locally for reference)
    "meshcentral-data/config.json": MC_CONFIG,
}

# ─── SSH/SCP Helpers ──────────────────────────────────────────────────────────


def ssh_cmd(command, capture=True, check=True, timeout=60):
    """Execute a command on the remote server."""
    full_cmd = ["ssh", SERVER, command]
    result = subprocess.run(full_cmd, capture_output=capture, text=True, timeout=timeout)
    if check and result.returncode != 0:
        print(f"[ERROR] Remote command failed (exit {result.returncode}):")
        print(f"  CMD: {command}")
        if result.stderr:
            print(f"  STDERR: {result.stderr.strip()}")
        return None
    return result.stdout.strip() if capture else result


def scp_up(local_path, remote_path):
    """Upload a file."""
    result = subprocess.run(
        ["scp", str(local_path), f"{SERVER}:{remote_path}"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        print(f"[ERROR] Upload failed: {local_path} → {remote_path}")
        if result.stderr:
            print(f"  {result.stderr.strip()}")
        return False
    return True


def scp_down(remote_path, local_path):
    """Download a file."""
    Path(local_path).parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["scp", f"{SERVER}:{remote_path}", str(local_path)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        print(f"[ERROR] Download failed: {remote_path} → {local_path}")
        return False
    return True


def file_hash(path):
    """SHA256 hash of a local file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def remote_hash(path):
    """SHA256 hash of a remote file."""
    result = ssh_cmd(f"sha256sum {path} 2>/dev/null || echo MISSING", check=False)
    if result and "MISSING" not in result:
        return result.split()[0]
    return None


def unified_diff(local_path, remote_tmp_path):
    """Return a unified diff string with a portable Python fallback on Windows."""
    if shutil.which("diff"):
        diff_result = subprocess.run(
            ["diff", "--unified=3", remote_tmp_path, str(local_path)],
            capture_output=True, text=True,
        )
        return diff_result.stdout

    with open(remote_tmp_path, "r", encoding="utf-8", errors="replace") as f:
        remote_lines = f.readlines()
    with open(local_path, "r", encoding="utf-8", errors="replace") as f:
        local_lines = f.readlines()
    return "".join(
        difflib.unified_diff(
            remote_lines,
            local_lines,
            fromfile=remote_tmp_path,
            tofile=str(local_path),
            n=3,
        )
    )


# ─── Commands ─────────────────────────────────────────────────────────────────

def cmd_status(args):
    """Show server status and MeshCentral version."""
    print("=" * 60)
    print("  MeshCentral Server Status")
    print("=" * 60)

    info = ssh_cmd("""
        echo "Host: $(hostname)"
        echo "Uptime: $(uptime -p)"
        echo "Kernel: $(uname -r)"
        echo "Disk: $(df -h / | tail -1 | awk '{print $3 "/" $2 " (" $5 " used)"}')"
        echo "Node: $(node -v)"
        echo "MeshCentral: $(node -e \"console.log(require('/opt/meshcentral/node_modules/meshcentral/package.json').version)\" 2>/dev/null)"
        echo "Service: $(systemctl is-active meshcentral)"
        echo "PID: $(systemctl show meshcentral --property=MainPID --value)"
        echo "Memory: $(systemctl show meshcentral --property=MemoryCurrent --value | awk '{printf \"%.0f MB\", $1/1024/1024}')"
    """)
    if info:
        for line in info.split("\n"):
            if line.strip():
                print(f"  {line}")

    # Show customized files
    print(f"\n{'─' * 60}")
    print("  Tracked Customizations (local → remote):")
    for local_rel, remote in FILE_MAP.items():
        local_path = LOCAL_SERVER / local_rel
        local_exists = "YES" if local_path.exists() else " - "
        remote_exists = ssh_cmd(f"test -f {remote} && echo YES || echo ' - '", check=False) or " - "
        print(f"    [{local_exists.strip():>3s}|{remote_exists.strip():>3s}] {local_rel}")

    # Show recent backups
    print(f"\n{'─' * 60}")
    backups = ssh_cmd(f"ls -1dt {MC_BACKUP}/*/ 2>/dev/null | head -5 || echo '(none)'", check=False)
    print("  Server Backups:")
    if backups and "(none)" not in backups:
        for b in backups.split("\n"):
            bname = b.rstrip("/").split("/")[-1]
            print(f"    {bname}")
    else:
        print("    (none)")
    print()


def cmd_pull(args):
    """Pull current server files to local working copy."""
    print("Pulling server files to local working copy...\n")

    for local_rel, remote in FILE_MAP.items():
        local_path = LOCAL_SERVER / local_rel
        print(f"  {remote} → {local_rel}...", end=" ", flush=True)
        if scp_down(remote, local_path):
            print("OK")
        else:
            print("SKIP (not found on server)")

    print(f"\nLocal working copy: {LOCAL_SERVER}")
    print("[DONE] Pull complete.")


def cmd_diff(args):
    """Show diff between local working copy and server files."""
    print("Comparing local vs server...\n")

    any_diff = False
    for local_rel, remote in FILE_MAP.items():
        local_path = LOCAL_SERVER / local_rel
        if not local_path.exists():
            print(f"  [SKIP] {local_rel} — not in local working copy")
            continue

        local_h = file_hash(local_path)
        remote_h = remote_hash(remote)

        if remote_h is None:
            print(f"  [NEW]  {local_rel} — not on server yet")
            any_diff = True
        elif local_h != remote_h:
            print(f"  [DIFF] {local_rel}")
            any_diff = True
            # Show actual diff
            with tempfile.NamedTemporaryFile(suffix=local_path.suffix, delete=False, mode="w") as tmp:
                tmp_path = tmp.name
            scp_down(remote, tmp_path)
            diff_text = unified_diff(local_path, tmp_path)
            if diff_text:
                for line in diff_text.split("\n")[:40]:
                    print(f"    {line}")
                total_lines = len(diff_text.split("\n"))
                if total_lines > 40:
                    print(f"    ... ({total_lines - 40} more lines)")
            os.unlink(tmp_path)
        else:
            print(f"  [ OK ] {local_rel} — in sync")

    if not any_diff:
        print("\nAll tracked files are in sync.")
    else:
        print("\nRun 'deploy-server.py push' to deploy changes.")


def cmd_push(args):
    """Push local changes to server with backup and restart."""
    print("=" * 60)
    print("  Push MeshCentral Changes")
    print("=" * 60)

    # Determine which files to push
    files_to_push = []
    if args.file:
        # Push specific file(s)
        for f in args.file:
            if f in FILE_MAP:
                local_path = LOCAL_SERVER / f
                if local_path.exists():
                    files_to_push.append((f, FILE_MAP[f], local_path))
                else:
                    print(f"[ERROR] Local file not found: {local_path}")
                    return False
            else:
                print(f"[ERROR] Unknown file: {f}")
                print(f"  Known files: {', '.join(FILE_MAP.keys())}")
                return False
    else:
        # Push all changed files
        for local_rel, remote in FILE_MAP.items():
            local_path = LOCAL_SERVER / local_rel
            if not local_path.exists():
                continue
            local_h = file_hash(local_path)
            remote_h = remote_hash(remote)
            if remote_h is None or local_h != remote_h:
                files_to_push.append((local_rel, remote, local_path))

    if not files_to_push:
        print("\nNo changes to push. Everything is in sync.")
        return True

    print(f"\nFiles to push:")
    for local_rel, remote, local_path in files_to_push:
        size = local_path.stat().st_size
        print(f"  {local_rel:<45s} ({size:,} bytes) → {remote}")

    if args.dry_run:
        print("\n[DRY RUN] No changes made.")
        return True

    if not args.yes:
        resp = input(f"\nPush {len(files_to_push)} file(s) and restart MeshCentral? [y/N] ")
        if resp.lower() != "y":
            print("Aborted.")
            return False

    # Backup
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_path = f"{MC_BACKUP}/{ts}"
    print(f"\n  [1/3] Backing up current files → {backup_path}")
    ssh_cmd(f"mkdir -p {backup_path}")
    for local_rel, remote, _ in files_to_push:
        safe_name = local_rel.replace("/", "_")
        ssh_cmd(f"cp -a {remote} {backup_path}/{safe_name} 2>/dev/null || true")
    print("    Done.")

    # Push
    print(f"\n  [2/3] Uploading files")
    for local_rel, remote, local_path in files_to_push:
        # Ensure remote directory exists
        remote_dir = "/".join(remote.split("/")[:-1])
        ssh_cmd(f"mkdir -p {remote_dir}")
        print(f"    {local_rel}...", end=" ", flush=True)
        if scp_up(local_path, remote):
            # Fix ownership
            ssh_cmd(f"chown meshcentral:meshcentral {remote} 2>/dev/null || true")
            print("OK")
        else:
            print("FAILED")
            return False
    print("    Done.")

    # Restart
    print(f"\n  [3/3] Restarting MeshCentral")
    ssh_cmd(f"systemctl restart {SERVICE_NAME}")
    time.sleep(3)

    status = ssh_cmd(f"systemctl is-active {SERVICE_NAME}", check=False)
    if status and "active" in status:
        print(f"    Service: {status}")
        print("\n[SUCCESS] Push complete!")
    else:
        print(f"    [WARNING] Service: {status}")
        print("    Check: deploy-server.py logs 50")

    return True


def cmd_update(args):
    """Update MeshCentral via npm on the server."""
    print("=" * 60)
    print("  MeshCentral npm Update")
    print("=" * 60)

    # Current version
    current = ssh_cmd(
        f"node -e \"console.log(require('{MC_MODULE}/package.json').version)\"",
        check=False,
    )
    print(f"\n  Current version: {current}")

    # Check available
    available = ssh_cmd("npm view meshcentral version 2>/dev/null", check=False)
    print(f"  Latest available: {available}")

    if current == available:
        print("\n  Already on latest version.")
        if not args.force:
            return True

    if not args.yes:
        resp = input(f"\n  Update MeshCentral {current} → {available}? [y/N] ")
        if resp.lower() != "y":
            print("  Aborted.")
            return False

    # Full backup
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_path = f"{MC_BACKUP}/npm-update-{ts}"
    print(f"\n  [1/5] Full backup → {backup_path}")
    ssh_cmd(f"mkdir -p {backup_path}")

    # Backup customized files
    for local_rel, remote in FILE_MAP.items():
        safe_name = local_rel.replace("/", "_")
        ssh_cmd(f"cp -a {remote} {backup_path}/{safe_name} 2>/dev/null || true")

    # Backup entire meshcentral module version info
    ssh_cmd(f"cp {MC_MODULE}/package.json {backup_path}/package.json.pre-update")
    print("    Done.")

    # Stop service
    print(f"\n  [2/5] Stopping MeshCentral")
    ssh_cmd(f"systemctl stop {SERVICE_NAME}")
    time.sleep(2)

    # npm update
    print(f"\n  [3/5] Running npm update (this may take a minute)...")
    update_result = ssh_cmd(
        f"cd {MC_BASE} && npm update meshcentral 2>&1",
        check=False,
        timeout=300,
    )
    if update_result:
        for line in update_result.split("\n")[-10:]:
            print(f"    {line}")

    # Reapply customizations
    print(f"\n  [4/5] Reapplying customized files")
    reapply_count = 0
    for local_rel, remote in FILE_MAP.items():
        if local_rel == "meshcentral-data/config.json":
            continue  # Config is in meshcentral-data, not affected by npm update
        local_path = LOCAL_SERVER / local_rel
        if local_path.exists():
            print(f"    Reapplying {local_rel}...", end=" ", flush=True)
            remote_dir = "/".join(remote.split("/")[:-1])
            ssh_cmd(f"mkdir -p {remote_dir}")
            if scp_up(local_path, remote):
                ssh_cmd(f"chown meshcentral:meshcentral {remote} 2>/dev/null || true")
                print("OK")
                reapply_count += 1
            else:
                print("FAILED")
    print(f"    Reapplied {reapply_count} customization(s).")

    # Start service
    print(f"\n  [5/5] Starting MeshCentral")
    ssh_cmd(f"systemctl start {SERVICE_NAME}")
    time.sleep(5)

    new_ver = ssh_cmd(
        f"node -e \"console.log(require('{MC_MODULE}/package.json').version)\"",
        check=False,
    )
    status = ssh_cmd(f"systemctl is-active {SERVICE_NAME}", check=False)
    print(f"\n  Version: {current} → {new_ver}")
    print(f"  Service: {status}")

    if status and "active" in status:
        print("\n[SUCCESS] Update complete!")
    else:
        print("\n[WARNING] Service may not have started. Check logs.")


def cmd_rollback(args):
    """Restore server files from backup."""
    print("=" * 60)
    print("  Server Rollback")
    print("=" * 60)

    backups = ssh_cmd(f"ls -1dt {MC_BACKUP}/*/ 2>/dev/null", check=False)
    if not backups:
        print("[ERROR] No backups found.")
        return False

    backup_list = [b.rstrip("/") for b in backups.split("\n") if b.strip()]
    print("\n  Available backups:")
    for i, b in enumerate(backup_list[:10]):
        bname = b.split("/")[-1]
        files = ssh_cmd(f"ls -1 {b}/ 2>/dev/null | wc -l", check=False) or "?"
        print(f"    [{i}] {bname}  ({files.strip()} files)")

    idx_str = input(f"\n  Select backup [0]: ") or "0"
    idx = int(idx_str)
    if idx >= len(backup_list):
        print("[ERROR] Invalid selection.")
        return False

    selected = backup_list[idx]
    bname = selected.split("/")[-1]

    # Show backup contents
    contents = ssh_cmd(f"ls -1 {selected}/")
    print(f"\n  Files in {bname}:")
    if contents:
        for f in contents.split("\n"):
            print(f"    {f}")

    if not args.yes:
        resp = input(f"\n  Restore from {bname} and restart? [y/N] ")
        if resp.lower() != "y":
            print("  Aborted.")
            return False

    # Restore each file
    print(f"\n  Restoring files...")
    for local_rel, remote in FILE_MAP.items():
        safe_name = local_rel.replace("/", "_")
        backup_file = f"{selected}/{safe_name}"
        exists = ssh_cmd(f"test -f {backup_file} && echo yes || echo no", check=False)
        if exists and exists.strip() == "yes":
            ssh_cmd(f"cp -f {backup_file} {remote}")
            ssh_cmd(f"chown meshcentral:meshcentral {remote} 2>/dev/null || true")
            print(f"    Restored: {local_rel}")

    ssh_cmd(f"systemctl restart {SERVICE_NAME}")
    time.sleep(3)
    status = ssh_cmd(f"systemctl is-active {SERVICE_NAME}", check=False)
    print(f"\n  Service: {status}")
    print(f"[DONE] Rolled back to {bname}")


def cmd_config(args):
    """View or edit MeshCentral config."""
    if args.action == "edit":
        local_config = LOCAL_SERVER / "config" / "config.json"

        # Pull latest
        print("Pulling latest config...")
        scp_down(MC_CONFIG, local_config)

        with open(local_config, "rb") as f:
            orig_hash = hashlib.sha256(f.read()).hexdigest()

        editor = os.environ.get("EDITOR", "notepad" if sys.platform == "win32" else "nano")
        print(f"Opening in {editor}...")
        subprocess.run([editor, str(local_config)])

        with open(local_config, "rb") as f:
            new_hash = hashlib.sha256(f.read()).hexdigest()

        if orig_hash == new_hash:
            print("No changes. Skipping.")
            return True

        # Validate JSON
        try:
            with open(local_config) as f:
                json.load(f)
        except json.JSONDecodeError as e:
            print(f"[ERROR] Invalid JSON: {e}")
            return False

        # Backup and push
        ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        ssh_cmd(f"cp {MC_CONFIG} {MC_CONFIG}.bak.{ts}")
        print("Uploading config...")
        scp_up(local_config, MC_CONFIG)

        resp = input("Restart MeshCentral? [y/N] ")
        if resp.lower() == "y":
            ssh_cmd(f"systemctl restart {SERVICE_NAME}")
            time.sleep(3)
            print(f"Service: {ssh_cmd(f'systemctl is-active {SERVICE_NAME}', check=False)}")

        print("[DONE] Config updated.")
    else:
        config = ssh_cmd(f"cat {MC_CONFIG}")
        if config:
            try:
                print(json.dumps(json.loads(config), indent=2))
            except json.JSONDecodeError:
                print(config)


def cmd_logs(args):
    """Tail MeshCentral service logs."""
    n = args.lines or 50
    print(f"Last {n} lines:\n")
    logs = ssh_cmd(
        f"journalctl -u {SERVICE_NAME} --no-pager -n {n} 2>/dev/null",
        check=False,
        timeout=15,
    )
    if logs:
        print(logs)


def cmd_health(args):
    """Full server health check."""
    print("=" * 60)
    print("  MeshCentral Health Check")
    print("=" * 60)

    checks = [
        ("Service active", f"systemctl is-active {SERVICE_NAME}"),
        ("MeshCentral version", f"node -e \"console.log(require('{MC_MODULE}/package.json').version)\""),
        ("Port 4430 (web)", "ss -tlnp | grep 4430 | head -1"),
        ("Port 4445 (agent)", "ss -tlnp | grep 4445 | head -1"),
        ("Port 4446 (relay)", "ss -tlnp | grep 4446 | head -1"),
        ("Node process", "pgrep -a node | grep meshcentral | head -1"),
        ("MongoDB", "mongosh --eval 'db.stats().collections' meshcentral --quiet 2>/dev/null || mongo --eval 'db.stats().collections' meshcentral --quiet 2>/dev/null || echo 'client not found'"),
        ("Let's Encrypt certs", f"ls -la {MC_DATA}/letsencrypt-certs/*.pem 2>/dev/null | wc -l"),
        ("Disk", "df -h / | tail -1"),
        ("Memory", "free -h | grep Mem"),
        ("Custom.js present", f"test -f {MC_WEB}/public/scripts/custom.js && echo YES || echo NO"),
        ("Recent errors (5m)", f"journalctl -u {SERVICE_NAME} --no-pager --since '5 min ago' --priority=err 2>/dev/null | wc -l"),
    ]

    all_ok = True
    for label, cmd in checks:
        result = ssh_cmd(cmd, check=False)
        val = (result or "").split("\n")[0][:60]
        ok = bool(result and result.strip() and "not found" not in result and "NO" not in result)
        if not ok:
            all_ok = False
        indicator = "+" if ok else "!"
        print(f"  [{indicator}] {label:<25s} {val}")

    print(f"\n{'─' * 60}")
    print("  All checks passed." if all_ok else "  Some checks need attention.")
    print()


def cmd_ssh(args):
    """Run an arbitrary command on the server."""
    command = " ".join(args.command)
    if not command:
        print("Usage: deploy-server.py ssh <command>")
        return
    result = ssh_cmd(command, check=False)
    if result is not None:
        print(result)


def cmd_vscode(args):
    """Open VS Code connected to the MeshCentral server."""
    print("Opening VS Code Remote-SSH to meshcentral server...")
    print(f"  Target: {MC_BASE}")

    # Find VS Code executable
    code_paths = [
        "code",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"),
        r"C:\Program Files\Microsoft VS Code\bin\code.cmd",
    ]
    code_exe = None
    for p in code_paths:
        if os.path.exists(p) or p == "code":
            try:
                subprocess.run([p, "--version"], capture_output=True, timeout=5)
                code_exe = p
                break
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue

    if not code_exe:
        # Fallback: use URI scheme
        uri = f"vscode://vscode-remote/ssh-remote+meshcentral{MC_BASE}"
        print(f"  Launching via URI: {uri}")
        os.startfile(uri)
    else:
        subprocess.Popen(
            [code_exe, "--remote", f"ssh-remote+meshcentral", MC_BASE],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    print("[DONE] VS Code should be opening. SSH config alias: 'meshcentral'.")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="MeshCentral Server Deployment Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("status", help="Server status and customizations")

    sub.add_parser("pull", help="Pull server files to local working copy")

    push_p = sub.add_parser("push", help="Push local changes to server")
    push_p.add_argument("--file", "-f", action="append", help="Specific file(s) to push (can repeat)")
    push_p.add_argument("--dry-run", action="store_true", help="Show what would be pushed")
    push_p.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")

    sub.add_parser("diff", help="Diff local vs server files")

    update_p = sub.add_parser("update", help="npm update meshcentral")
    update_p.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    update_p.add_argument("--force", action="store_true", help="Force even if same version")

    rollback_p = sub.add_parser("rollback", help="Restore from backup")
    rollback_p.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")

    config_p = sub.add_parser("config", help="View or edit config")
    config_p.add_argument("action", nargs="?", default="view", choices=["view", "edit"])

    logs_p = sub.add_parser("logs", help="View service logs")
    logs_p.add_argument("lines", nargs="?", type=int, default=50)

    sub.add_parser("health", help="Health check")

    ssh_p = sub.add_parser("ssh", help="Run remote command")
    ssh_p.add_argument("command", nargs=argparse.REMAINDER)

    sub.add_parser("vscode", help="Open VS Code Remote-SSH")

    args = parser.parse_args()

    if not args.cmd:
        parser.print_help()
        return

    commands = {
        "status": cmd_status,
        "pull": cmd_pull,
        "push": cmd_push,
        "diff": cmd_diff,
        "update": cmd_update,
        "rollback": cmd_rollback,
        "config": cmd_config,
        "logs": cmd_logs,
        "health": cmd_health,
        "ssh": cmd_ssh,
        "vscode": cmd_vscode,
    }

    commands[args.cmd](args)


if __name__ == "__main__":
    main()
