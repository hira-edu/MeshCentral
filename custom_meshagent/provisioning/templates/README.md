# Provisioning Templates

Templates for generating customised `meshagent.msh` provisioning files. These
should include placeholders for:
- Primary endpoint (domain/IP).
- TLS/SNI options and ALPN lists.
- Custom HTTP headers, user-agent.
- Certificate pinning / fingerprints.

Generation scripts in `../generators` will merge branding configuration into
these templates.
