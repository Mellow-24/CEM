# Agent Note: Authenticated IP deployment for CEM

Status: implemented

English | [中文](2026-09-15-cem-authenticated-ip-deployment.zh.md)

## Problem

The CEM customer portal needs a public demonstration deployment before it has a domain. A bare HTTP IP cannot provide the secure browser context required by microphone capture, while publishing the shared Session and administration APIs without access control would expose customer conversations and operator functions.

## Decision

The Beijing demonstration instance keeps the application bound to `127.0.0.1:3080` and exposes it only through Nginx. Nginx authenticates the complete site, redirects the root path to `/customer`, proxies streaming and upgraded connections without buffering, and terminates a publicly trusted short-lived certificate for the server IP address.

The deployment overlay sets `speech-web.authority` to `trusted-host`, and the service passes the public IP through `--trusted-host`. These two settings authorize the browser authority only after Nginx authentication; they do not treat the host allowlist as user authentication. Runtime credentials remain in the root-readable server environment file, and Session, knowledge, quality, pronunciation, and retrieval-index state remain under the `dsh` service account's persistent data directory.

The IP certificate uses the short-lived ACME profile and renews automatically several times per day. A later domain deployment replaces the Nginx certificate and trusted authority together rather than serving both identities indefinitely.

## Alternatives considered

**Expose port 3080 directly.** Rejected because the Web launcher deliberately binds loopback, direct HTTP does not enable browser microphone access, and it bypasses the reverse proxy's authentication and transport controls.

**Use a self-signed certificate.** Rejected because every client would need a private trust installation and browser microphone behavior would depend on that manual setup.

**Wait for a registered domain.** Rejected for the demonstration instance because a publicly trusted IP certificate supplies the required secure context without making a domain or ICP filing a prerequisite. A domain remains the preferred stable public identity.

## Consequences

The customer portal, voice input, telephone interface, shared APIs, and administration page use one authenticated HTTPS origin. Demonstration users receive an HTTP Basic authentication prompt. The six-day IP certificate requires reliable automated renewal, and loss of the public IP requires a new certificate and trusted-host value. The configuration does not provide per-customer identity or tenant isolation, so it remains a controlled demonstration deployment rather than an anonymous public service.
