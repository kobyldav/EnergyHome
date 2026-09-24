# Security Policy

## Supported versions

Energy Home is currently an early-stage project.

Security fixes are normally applied to the latest published version. Users are encouraged to update to the newest available release.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | Best effort |

## Reporting a vulnerability

Please **do not publish security vulnerabilities as a normal public GitHub Issue** when the report contains exploit details, sensitive information, or a vulnerability that could put users at risk.

The preferred reporting method is GitHub's **Private vulnerability reporting** feature for this repository.

Repository maintainers should enable it under:

**Settings → Security → Private vulnerability reporting**

If private vulnerability reporting is temporarily unavailable, open a minimal GitHub Issue asking for a private contact channel, but do not include exploit code, sensitive data, credentials, or detailed reproduction steps in that public issue.

Repository:

https://github.com/kobyldav/EnergyHome

## What to include

A useful security report should contain:

- affected Energy Home version;
- affected operating system;
- description of the vulnerability;
- reproducible steps;
- expected and observed behavior;
- potential security impact;
- proof of concept, when appropriate;
- suggested mitigation, if known.

Do not include real household energy records or other private user data.

## Response process

The maintainer will attempt to:

1. acknowledge the report;
2. reproduce and assess the issue;
3. develop and test a fix;
4. prepare a new release when necessary;
5. disclose the issue responsibly after users have had a reasonable opportunity to update.

Exact response times are not guaranteed because Energy Home is currently maintained as an independent open-source project.

## Release integrity

Official release artifacts should be distributed through the project's GitHub Releases page.

Where provided, users can verify SHA-256 checksums before installation.

The project is also preparing an authenticated code-signing process. See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).
