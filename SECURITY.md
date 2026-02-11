# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | Yes                |

## Reporting a Vulnerability

If you discover a security vulnerability in AgentDoor, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email your findings to the maintainers via GitHub's [private vulnerability reporting](https://github.com/0xaron/agentdoor/security/advisories/new).
2. Include a description of the vulnerability, steps to reproduce, and any potential impact.
3. If possible, include a proof of concept or minimal reproduction.

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours.
- **Assessment**: We will investigate and assess the severity within 7 days.
- **Fix**: For confirmed vulnerabilities, we aim to release a patch within 14 days of confirmation, depending on complexity.
- **Disclosure**: We will coordinate disclosure with you. We ask that you do not publicly disclose the vulnerability until a fix is available.

### Scope

The following are in scope:

- All packages published under `@agentdoor/*` on npm
- The `agentdoor` and `agentdoor-fastapi` packages on PyPI
- The AgentDoor discovery protocol and authentication flow
- Cryptographic operations (Ed25519 signing/verification, JWT issuance)
- Storage drivers (memory, SQLite, PostgreSQL, Redis)

### Out of Scope

- Vulnerabilities in third-party dependencies (report these upstream)
- Issues in example code or deployment templates that are not part of the published packages
- Social engineering attacks

## Security Design

AgentDoor's authentication is built on Ed25519 challenge-response:

- Private keys never leave the agent
- Challenge nonces expire after 5 minutes
- JWTs are short-lived (default: 1 hour)
- Token refresh requires a fresh Ed25519 signature (stolen JWTs cannot be refreshed)
- API keys are stored as SHA-256 hashes

For more details, see the [API Reference](./docs/api-reference.md).
