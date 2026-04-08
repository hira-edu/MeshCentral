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
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse, urlunparse

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def resolve_ssh_config_path():
    """Return an operator-specified SSH config or a known local failover config if present."""
    configured = os.environ.get("MESHCENTRAL_SSH_CONFIG")
    if configured:
        return configured
    candidate = Path(tempfile.gettempdir()) / "meshcentral_proxy_failover.sshconfig"
    if candidate.exists():
        return str(candidate)
    return None


# ─── Configuration ────────────────────────────────────────────────────────────

SERVER = "meshcentral"  # SSH config alias (resolves to 167.88.44.65)
SERVER_IP = "167.88.44.65"
SSH_CONFIG_PATH = resolve_ssh_config_path()
SSH_OPTIONS = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "ConnectionAttempts=1",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
]

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
LOCAL_CONFIG_PATH = LOCAL_SERVER / "meshcentral-data" / "config.json"
DEFAULT_DOMAIN_ID = ""
PROVISIONING_FILES = (
    "agents/MeshService64.msh",
    "meshcentral-data/signedagents/MeshService64.msh",
)
LOCAL_WEBSERVER_CERT_PATH = LOCAL_SERVER / "meshcentral-data" / "webserver-cert-public.crt"

# File mapping: local relative path (in repo) → remote absolute path (on server)
# Add entries here as you customize more server files
FILE_MAP = {
    # Custom web overlay (lives outside the npm module on server)
    "public/scripts/custom.js": f"{MC_WEB}/public/scripts/custom.js",
    "public/scripts/agent-desktop-0.0.2.js": f"{MC_MODULE}/public/scripts/agent-desktop-0.0.2.js",
    "public/scripts/agent-desktop-0.0.2-min.js": f"{MC_MODULE}/public/scripts/agent-desktop-0.0.2-min.js",
    "public/scripts/agent-redir-ws-0.1.1.js": f"{MC_MODULE}/public/scripts/agent-redir-ws-0.1.1.js",
    "public/scripts/agent-redir-ws-0.1.1-min.js": f"{MC_MODULE}/public/scripts/agent-redir-ws-0.1.1-min.js",

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
    "webserver.js": f"{MC_MODULE}/webserver.js",

    # Server modules
    "meshdevicefile.js": f"{MC_MODULE}/meshdevicefile.js",
    "meshagent.js": f"{MC_MODULE}/meshagent.js",
    "meshdesktopmultiplex.js": f"{MC_MODULE}/meshdesktopmultiplex.js",

    # Config (stored in meshcentral-data/ locally for reference)
    "meshcentral-data/config.json": MC_CONFIG,
    "agents/MeshService64.msh": f"{MC_MODULE}/agents/MeshService64.msh",
    "meshcentral-data/signedagents/MeshService64.msh": f"{MC_DATA}/signedagents/MeshService64.msh",
}

# ─── SSH/SCP Helpers ──────────────────────────────────────────────────────────


def build_remote_cmd(binary):
    """Build an SSH-family command honoring an optional external SSH config file."""
    cmd = [binary]
    if SSH_CONFIG_PATH:
        cmd.extend(["-F", SSH_CONFIG_PATH])
    cmd.extend(SSH_OPTIONS)
    return cmd


def probe_ssh_route(timeout=20):
    """Check whether the configured SSH route can reach the remote host."""
    result = subprocess.run(
        [*build_remote_cmd("ssh"), SERVER, "exit 0"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return result.returncode == 0, result


def ssh_cmd(command, capture=True, check=True, timeout=60):
    """Execute a command on the remote server."""
    full_cmd = [*build_remote_cmd("ssh"), SERVER, command]
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
        [*build_remote_cmd("scp"), str(local_path), f"{SERVER}:{remote_path}"],
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
        [*build_remote_cmd("scp"), f"{SERVER}:{remote_path}", str(local_path)],
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


def load_local_config():
    """Load the local MeshCentral config file."""
    if not LOCAL_CONFIG_PATH.exists():
        print(f"[ERROR] Local config not found: {LOCAL_CONFIG_PATH}")
        return None
    with open(LOCAL_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_local_config(config):
    """Write the local MeshCentral config file with deterministic formatting."""
    LOCAL_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCAL_CONFIG_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(config, f, indent=2)
        f.write("\n")


def build_agent_route(domain_id):
    """Return the agent route path for a MeshCentral domain."""
    return f"{domain_id}/agent.ashx" if domain_id else "agent.ashx"


def get_domain_config(config, domain_id=DEFAULT_DOMAIN_ID):
    """Fetch a domain configuration block."""
    return config.get("domains", {}).get(domain_id, {})


def get_web_alias_host(config, domain_id=DEFAULT_DOMAIN_ID):
    """Resolve the public web hostname used by agents."""
    domain = get_domain_config(config, domain_id)
    domain_url = domain.get("url")
    if isinstance(domain_url, str) and domain_url:
        parsed = urlparse(domain_url)
        if parsed.hostname:
            return parsed.hostname
    settings = config.get("settings", {})
    return settings.get("cert")


def normalize_https_url(value):
    """Normalize an HTTPS URL or hostname into a stable URL string."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    if "://" not in value:
        value = "https://" + value
    parsed = urlparse(value)
    netloc = parsed.netloc or parsed.path
    if not netloc:
        return None
    path = parsed.path if parsed.netloc else ""
    if not path:
        path = "/"
    elif not path.endswith("/"):
        path += "/"
    return urlunparse((parsed.scheme or "https", netloc, path, "", "", ""))


def get_domain_certurl(config, domain_id=DEFAULT_DOMAIN_ID):
    """Return the configured proxy certificate URL for a domain, if any."""
    domain = get_domain_config(config, domain_id)
    for key in ("certurl", "certUrl"):
        normalized = normalize_https_url(domain.get(key))
        if normalized:
            return normalized
    return None


def get_domain_certurl_key_state(config, domain_id=DEFAULT_DOMAIN_ID):
    """Return canonical and legacy certurl key usage for a domain."""
    domain = get_domain_config(config, domain_id)
    canonical_raw = domain.get("certurl")
    legacy_raw = domain.get("certUrl")
    return {
        "canonical": normalize_https_url(canonical_raw),
        "legacy": normalize_https_url(legacy_raw),
        "has_canonical": isinstance(canonical_raw, str) and bool(canonical_raw.strip()),
        "has_legacy": isinstance(legacy_raw, str) and bool(legacy_raw.strip()),
    }


def get_expected_certurl(config, domain_id=DEFAULT_DOMAIN_ID):
    """Return the public certificate URL agents are expected to see."""
    domain = get_domain_config(config, domain_id)
    normalized = normalize_https_url(domain.get("url"))
    if normalized:
        return normalized
    return normalize_https_url(get_web_alias_host(config, domain_id))


def build_wss_url(host, port, path):
    """Build a websocket endpoint URL."""
    if not host or port is None:
        return None
    return f"wss://{host}:{int(port)}/{path}"


def unique_preserve_order(values, *skip_values):
    """Return a deduplicated list while preserving order."""
    skips = {v for v in skip_values if v}
    seen = set()
    result = []
    for value in values:
        if not value or value in skips or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def compute_agent_endpoints(config, domain_id=DEFAULT_DOMAIN_ID):
    """Compute primary and fallback agent endpoints from local config."""
    settings = config.get("settings", {})
    route = build_agent_route(domain_id)
    web_host = get_web_alias_host(config, domain_id)
    web_port = settings.get("aliasPort", settings.get("port"))
    agent_host = settings.get("agentAliasDNS") or web_host
    agent_port = settings.get("agentAliasPort", settings.get("agentPort", web_port))
    relay_port = settings.get("relayAliasPort", settings.get("relayPort"))

    primary = build_wss_url(agent_host, agent_port, route)
    web_fallback = build_wss_url(web_host, web_port, route)
    relay_fallback = build_wss_url(agent_host, relay_port, route)
    fallbacks = unique_preserve_order([web_fallback, relay_fallback], primary)

    return {
        "primary": primary,
        "fallbacks": fallbacks,
        "all": unique_preserve_order([primary, *fallbacks]),
    }


def parse_endpoint_list(value):
    """Parse a MeshAgent fallback endpoint list."""
    if not value:
        return []
    return [item.strip() for item in value.split("|") if item.strip()]


def sync_domain_agent_config(config, domain_id=DEFAULT_DOMAIN_ID):
    """Normalize the agent fallbackEndpoints entry in config.json."""
    domain = get_domain_config(config, domain_id)
    if not domain:
        return False

    agent_config = list(domain.get("agentConfig", []))
    fallback_index = None
    normalized_lines = []

    for line in agent_config:
        if isinstance(line, str) and line.startswith("fallbackEndpoints="):
            if fallback_index is None:
                fallback_index = len(normalized_lines)
            continue
        normalized_lines.append(line)

    endpoints = compute_agent_endpoints(config, domain_id)
    merged_fallbacks = list(endpoints["fallbacks"])

    if merged_fallbacks:
        if fallback_index is None:
            fallback_index = len(normalized_lines)
        normalized_lines.insert(fallback_index, "fallbackEndpoints=" + "|".join(merged_fallbacks))

    changed = normalized_lines != agent_config
    if changed:
        domain["agentConfig"] = normalized_lines
    return changed


def sync_msh_file(path, primary_endpoint, fallback_endpoints, write=False):
    """Keep a checked-in .msh provisioning artifact aligned with local config."""
    if not path.exists():
        return False

    original_text = path.read_text(encoding="utf-8", errors="replace")
    original_lines = original_text.splitlines()
    lines = list(original_lines)
    meshserver_index = None
    fallback_index = None

    for index, line in enumerate(lines):
        if line.startswith("MeshServer="):
            meshserver_index = index
        elif line.startswith("fallbackEndpoints="):
            if fallback_index is None:
                fallback_index = index

    updated_lines = []
    for line in lines:
        if line.startswith("fallbackEndpoints="):
            continue
        updated_lines.append(line)

    if meshserver_index is not None:
        for index, line in enumerate(updated_lines):
            if line.startswith("MeshServer="):
                updated_lines[index] = f"MeshServer={primary_endpoint}"
                break

    merged_fallbacks = list(fallback_endpoints)

    if merged_fallbacks:
        if fallback_index is not None:
            insert_at = min(fallback_index, len(updated_lines))
        else:
            insert_at = None
            for index, line in enumerate(updated_lines):
                if line.startswith("MeshServer="):
                    insert_at = index + 1
                    break
            if insert_at is None:
                insert_at = len(updated_lines)
        updated_lines.insert(insert_at, "fallbackEndpoints=" + "|".join(merged_fallbacks))

    changed = updated_lines != original_lines
    if changed and write:
        updated_text = "\n".join(updated_lines) + "\n"
        path.write_text(updated_text, encoding="utf-8", newline="\n")
    return changed


def sync_provisioning_artifacts(write=False):
    """Sync config and checked-in provisioning artifacts from a single source of truth."""
    config = load_local_config()
    if config is None:
        return [], None

    changed_files = []
    if sync_domain_agent_config(config):
        changed_files.append("meshcentral-data/config.json")
        if write:
            save_local_config(config)

    endpoints = compute_agent_endpoints(config)
    for rel_path in PROVISIONING_FILES:
        if sync_msh_file(LOCAL_SERVER / rel_path, endpoints["primary"], endpoints["fallbacks"], write=write):
            changed_files.append(rel_path)

    return changed_files, endpoints


def describe_endpoint(endpoint):
    """Return host and port for a websocket endpoint."""
    parsed = urlparse(endpoint)
    return parsed.hostname, parsed.port or 443


def probe_tcp(host, port, timeout=3):
    """Check if a TCP endpoint is reachable from this machine."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, "reachable"
    except OSError as exc:
        return False, str(exc)


def extract_certificate_fingerprint(path):
    """Return the SHA1 fingerprint of a local certificate file."""
    path = Path(path)
    if not path.exists():
        return None
    raw = path.read_bytes()
    if b"-----BEGIN CERTIFICATE-----" in raw:
        text = raw.decode("utf-8", errors="replace")
        begin = text.find("-----BEGIN CERTIFICATE-----")
        end = text.find("-----END CERTIFICATE-----")
        if begin >= 0 and end >= 0:
            pem = text[begin:end + len("-----END CERTIFICATE-----")]
            raw = ssl.PEM_cert_to_DER_cert(pem)
    return hashlib.sha1(raw).hexdigest().upper()


def probe_tls_certificate(url, timeout=5):
    """Fetch the certificate currently presented by a public HTTPS endpoint."""
    normalized = normalize_https_url(url)
    if normalized is None:
        return None
    parsed = urlparse(normalized)
    host = parsed.hostname
    port = parsed.port or 443
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=host) as tls_sock:
                cert = tls_sock.getpeercert()
                cert_der = tls_sock.getpeercert(binary_form=True)
    except OSError as exc:
        return {"url": normalized, "error": str(exc)}

    subject = dict(item for entry in cert.get("subject", ()) for item in entry)
    issuer = dict(item for entry in cert.get("issuer", ()) for item in entry)
    return {
        "url": normalized,
        "host": host,
        "port": port,
        "subject_cn": subject.get("commonName"),
        "issuer_cn": issuer.get("commonName"),
        "not_after": cert.get("notAfter"),
        "sha1": hashlib.sha1(cert_der).hexdigest().upper(),
    }


def audit_proxy_certificate_config(config, domain_id=DEFAULT_DOMAIN_ID):
    """Audit the proxy certificate configuration needed for tlsOffload agents."""
    settings = (config or {}).get("settings", {})
    tls_offload = settings.get("tlsOffload")
    certurl_keys = get_domain_certurl_key_state(config, domain_id)
    report = {
        "enabled": bool(tls_offload),
        "tls_offload": tls_offload,
        "certurl": certurl_keys["canonical"] or certurl_keys["legacy"],
        "canonical_certurl": certurl_keys["canonical"],
        "legacy_certurl": certurl_keys["legacy"],
        "has_legacy_certurl_key": certurl_keys["has_legacy"],
        "recommended_certurl": get_expected_certurl(config, domain_id),
        "errors": [],
        "warnings": [],
        "public_cert": None,
        "local_web_cert_sha1": extract_certificate_fingerprint(LOCAL_WEBSERVER_CERT_PATH),
    }
    if not report["enabled"]:
        return report

    if certurl_keys["has_legacy"] and not certurl_keys["has_canonical"]:
        report["errors"].append(
            "domains[''].certUrl is mis-cased. MeshCentral only reads domains[''].certurl."
        )
    elif certurl_keys["has_legacy"] and certurl_keys["has_canonical"]:
        if certurl_keys["legacy"] != certurl_keys["canonical"]:
            report["errors"].append(
                "domains[''].certurl and domains[''].certUrl are both set with different values. "
                "Remove the legacy certUrl entry."
            )
        else:
            report["warnings"].append(
                "Legacy domains[''].certUrl is still present. Remove it to avoid future drift."
            )

    if report["certurl"] is None:
        report["errors"].append(
            "tlsOffload is enabled but domains[''].certurl is missing. "
            "Agents behind the public TLS front door can fail web-certificate validation."
        )
    elif report["recommended_certurl"] and (report["certurl"] != report["recommended_certurl"]):
        report["warnings"].append(
            "Configured certurl does not match the public domain URL. "
            "Verify it presents the same certificate agents see."
        )

    probe_url = report["certurl"] or report["recommended_certurl"]
    if probe_url:
        public_cert = probe_tls_certificate(probe_url)
        report["public_cert"] = public_cert
        if public_cert and public_cert.get("error"):
            report["warnings"].append(
                f"Unable to probe the proxy certificate at {probe_url}: {public_cert['error']}"
            )
        elif public_cert and report["local_web_cert_sha1"] and (public_cert["sha1"] != report["local_web_cert_sha1"]):
            if report["certurl"] is None:
                report["errors"].append(
                    "The public TLS certificate fingerprint differs from the local "
                    "meshcentral-data/webserver-cert-public.crt fingerprint. "
                    "Without certurl, agents can be held on BadWebCertHash."
                )
            else:
                report["warnings"].append(
                    "The public TLS certificate fingerprint differs from the local "
                    "meshcentral-data/webserver-cert-public.crt fingerprint. "
                    "This can be intentional when the local default certificate is preserved "
                    "for direct-agent compatibility; certurl must remain correct so MeshCentral "
                    "still tracks the public certificate agents see on the proxied ingress."
                )

    return report


def print_proxy_certificate_report(report):
    """Print the current proxy certificate audit result."""
    print(f"\n{'─' * 60}")
    print("  Proxy Certificate Audit:")
    if not report["enabled"]:
        print("    tlsOffload: disabled")
        return

    print(f"    tlsOffload: {report['tls_offload']}")
    print(f"    certurl:    {report['certurl'] or '(missing)'}")
    if report["recommended_certurl"]:
        print(f"    expected:   {report['recommended_certurl']}")

    public_cert = report.get("public_cert")
    if public_cert:
        if public_cert.get("error"):
            print(f"    publicCert: probe failed ({public_cert['error']})")
        else:
            print(
                "    publicCert: "
                f"CN={public_cert.get('subject_cn') or '?'}; "
                f"Issuer={public_cert.get('issuer_cn') or '?'}; "
                f"SHA1={public_cert.get('sha1') or '?'}"
            )
    if report.get("local_web_cert_sha1"):
        print(f"    localCert:  SHA1={report['local_web_cert_sha1']}")

    for error in report["errors"]:
        print(f"    [ERROR] {error}")
    for warning in report["warnings"]:
        print(f"    [WARN ] {warning}")


def ensure_server_reachable(action):
    """Fail fast when the deployment host cannot reach the server over SSH."""
    ok, probe_result = probe_ssh_route(timeout=20)
    if ok:
        return True
    print(f"[ERROR] Cannot reach {SERVER} using the configured SSH route; {action} cannot continue.")
    if SSH_CONFIG_PATH:
        print(f"        SSH config: {SSH_CONFIG_PATH}")
    elif SERVER_IP:
        print(f"        Direct host: {SERVER_IP}:22")
    stderr = (probe_result.stderr or "").strip()
    if stderr:
        print(f"        {stderr}")
    return False


def print_agent_endpoint_report(endpoints):
    """Print the primary and fallback agent endpoints derived from local config."""
    if not endpoints:
        return
    print(f"\n{'─' * 60}")
    print("  Agent Endpoints (local config):")
    print(f"    Primary:   {endpoints['primary']}")
    if endpoints["fallbacks"]:
        for index, endpoint in enumerate(endpoints["fallbacks"], start=1):
            print(f"    Fallback {index}: {endpoint}")
    else:
        print("    Fallbacks: (none)")


def print_public_probe_report(endpoints):
    """Print public TCP reachability for the configured agent endpoints."""
    if not endpoints:
        return
    print(f"\n{'─' * 60}")
    print("  Public Reachability (from this workstation):")
    for endpoint in endpoints["all"]:
        host, port = describe_endpoint(endpoint)
        ok, detail = probe_tcp(host, port, timeout=3)
        indicator = "+" if ok else "!"
        print(f"  [{indicator}] {host}:{port:<5d} {detail}")


def build_health_checks(config):
    """Build health checks that match the configured deployment topology."""
    settings = (config or {}).get("settings", {})
    checks = [
        ("Service active", f"systemctl is-active {SERVICE_NAME}"),
        ("MeshCentral version", f"node -e \"console.log(require('{MC_MODULE}/package.json').version)\""),
    ]

    web_port = settings.get("port")
    if isinstance(web_port, int) and (web_port > 0):
        checks.append((f"Port {web_port} (web)", f"ss -tlnp | grep ':{web_port} ' | head -1"))

    redir_port = settings.get("redirPort")
    if isinstance(redir_port, int) and (redir_port > 0):
        checks.append((f"Port {redir_port} (redir)", f"ss -tlnp | grep ':{redir_port} ' | head -1"))

    agent_port = settings.get("agentPort")
    if isinstance(agent_port, int) and (agent_port > 0):
        checks.append((f"Port {agent_port} (agent)", f"ss -tlnp | grep ':{agent_port} ' | head -1"))

    relay_port = settings.get("relayPort")
    if isinstance(relay_port, int) and (relay_port > 0) and (settings.get("relayDNS") is None):
        checks.append((f"Port {relay_port} (relay)", f"ss -tlnp | grep ':{relay_port} ' | head -1"))

    if settings.get("tlsOffload"):
        checks.extend([
            ("Caddy active", "systemctl is-active caddy"),
            ("Port 443 (edge)", "ss -tlnp | grep ':443 ' | head -1"),
        ])
    elif config.get("letsencrypt") is not None:
        checks.append(("Let's Encrypt certs", f"ls -la {MC_DATA}/letsencrypt-certs/*.pem 2>/dev/null | wc -l"))

    checks.extend([
        ("Node process", "pgrep -a node | grep meshcentral | head -1"),
        ("MongoDB", "mongosh --eval 'db.stats().collections' meshcentral --quiet 2>/dev/null || mongo --eval 'db.stats().collections' meshcentral --quiet 2>/dev/null || echo 'client not found'"),
        ("Disk", "df -h / | tail -1"),
        ("Memory", "free -h | grep Mem"),
        ("Custom.js present", f"test -f {MC_WEB}/public/scripts/custom.js && echo YES || echo NO"),
        ("Recent errors (5m)", f"journalctl -u {SERVICE_NAME} --no-pager --since '5 min ago' --priority=err 2>/dev/null | wc -l"),
    ])
    return checks


# ─── Commands ─────────────────────────────────────────────────────────────────

def cmd_status(args):
    """Show server status and MeshCentral version."""
    config = load_local_config() or {}
    drift, endpoints = sync_provisioning_artifacts(write=False)
    proxy_report = audit_proxy_certificate_config(config)
    print("=" * 60)
    print("  MeshCentral Server Status")
    print("=" * 60)

    if drift:
        print("  Local provisioning drift detected:")
        for rel_path in drift:
            print(f"    {rel_path}")
        print("  Run 'deploy-server.py push' to sync the config and .msh artifacts.")
        print()

    print_agent_endpoint_report(endpoints)
    print_proxy_certificate_report(proxy_report)

    server_reachable = ensure_server_reachable("status")
    if not server_reachable:
        print_public_probe_report(endpoints)
        print()
        return

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

    print_public_probe_report(endpoints)
    print()


def cmd_pull(args):
    """Pull current server files to local working copy."""
    if not ensure_server_reachable("pull"):
        return False

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
    drift, _ = sync_provisioning_artifacts(write=False)
    if drift:
        print("Local provisioning drift detected before diff:")
        for rel_path in drift:
            print(f"  [DRIFT] {rel_path}")
        print()

    if not ensure_server_reachable("diff"):
        return False

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
    config = load_local_config() or {}
    synced_files, endpoints = sync_provisioning_artifacts(write=not args.dry_run)
    proxy_report = audit_proxy_certificate_config(config)
    print("=" * 60)
    print("  Push MeshCentral Changes")
    print("=" * 60)

    if synced_files:
        print("\nProvisioning synced from local config:")
        for rel_path in synced_files:
            print(f"  {rel_path}")

    print_agent_endpoint_report(endpoints)
    print_proxy_certificate_report(proxy_report)

    if proxy_report["errors"]:
        print("\n[ERROR] Refusing to push while local proxy certificate validation is broken.")
        return False

    if not ensure_server_reachable("push"):
        print_public_probe_report(endpoints)
        return False

    # Determine which files to push
    files_to_push = []
    requested_files = list(args.file or [])
    for rel_path in synced_files:
        if rel_path not in requested_files:
            requested_files.append(rel_path)

    if args.file:
        # Push specific file(s)
        for f in requested_files:
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
        print_public_probe_report(endpoints)
        print("\n[SUCCESS] Push complete!")
    else:
        print(f"    [WARNING] Service: {status}")
        print("    Check: deploy-server.py logs 50")
        print_public_probe_report(endpoints)

    return True


def cmd_update(args):
    """Update MeshCentral via npm on the server."""
    config = load_local_config() or {}
    synced_files, endpoints = sync_provisioning_artifacts(write=True)
    proxy_report = audit_proxy_certificate_config(config)
    print("=" * 60)
    print("  MeshCentral npm Update")
    print("=" * 60)

    if synced_files:
        print("\nProvisioning synced from local config:")
        for rel_path in synced_files:
            print(f"  {rel_path}")

    print_proxy_certificate_report(proxy_report)

    if proxy_report["errors"]:
        print("\n[ERROR] Refusing to update while local proxy certificate validation is broken.")
        return False

    if not ensure_server_reachable("update"):
        print_public_probe_report(endpoints)
        return False

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
        print_public_probe_report(endpoints)
        print("\n[SUCCESS] Update complete!")
    else:
        print_public_probe_report(endpoints)
        print("\n[WARNING] Service may not have started. Check logs.")


def cmd_rollback(args):
    """Restore server files from backup."""
    if not ensure_server_reachable("rollback"):
        return False

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
        if not ensure_server_reachable("config edit"):
            return False

        local_config = LOCAL_CONFIG_PATH

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

        synced_files, endpoints = sync_provisioning_artifacts(write=True)
        if synced_files:
            print("Synced provisioning artifacts:")
            for rel_path in synced_files:
                print(f"  {rel_path}")

        # Backup and push
        ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        ssh_cmd(f"cp {MC_CONFIG} {MC_CONFIG}.bak.{ts}")
        print("Uploading config and provisioning artifacts...")
        for rel_path in ["meshcentral-data/config.json", *PROVISIONING_FILES]:
            local_path = LOCAL_SERVER / rel_path
            remote_path = FILE_MAP[rel_path]
            remote_dir = "/".join(remote_path.split("/")[:-1])
            ssh_cmd(f"mkdir -p {remote_dir}")
            if not scp_up(local_path, remote_path):
                return False
            ssh_cmd(f"chown meshcentral:meshcentral {remote_path} 2>/dev/null || true")

        resp = input("Restart MeshCentral? [y/N] ")
        if resp.lower() == "y":
            ssh_cmd(f"systemctl restart {SERVICE_NAME}")
            time.sleep(3)
            print(f"Service: {ssh_cmd(f'systemctl is-active {SERVICE_NAME}', check=False)}")
            print_public_probe_report(endpoints)

        print("[DONE] Config updated.")
    else:
        if not ensure_server_reachable("config view"):
            return False
        config = ssh_cmd(f"cat {MC_CONFIG}")
        if config:
            try:
                print(json.dumps(json.loads(config), indent=2))
            except json.JSONDecodeError:
                print(config)


def cmd_logs(args):
    """Tail MeshCentral service logs."""
    if not ensure_server_reachable("logs"):
        return False
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
    config = load_local_config() or {}
    drift, endpoints = sync_provisioning_artifacts(write=False)
    proxy_report = audit_proxy_certificate_config(config)
    print("=" * 60)
    print("  MeshCentral Health Check")
    print("=" * 60)

    if drift:
        print("  Local provisioning drift detected:")
        for rel_path in drift:
            print(f"    {rel_path}")
        print()

    print_agent_endpoint_report(endpoints)
    print_proxy_certificate_report(proxy_report)
    print_public_probe_report(endpoints)

    if not ensure_server_reachable("health"):
        print(f"\n{'─' * 60}")
        print("  Remote health checks skipped: SSH is unreachable.")
        print()
        return False

    checks = build_health_checks(config)

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
    if not ensure_server_reachable("ssh"):
        return False
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
