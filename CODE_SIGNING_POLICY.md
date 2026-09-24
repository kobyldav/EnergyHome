# Code Signing Policy

## Project

**Energy Home**

Repository:

https://github.com/kobyldav/EnergyHome

## Code signing provider

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.**

Energy Home intends to use SignPath's Open Source Code Signing service for official Windows release artifacts after the project has been accepted by SignPath Foundation and the signing workflow has been configured.

Until that process is active, test and release-candidate binaries may be unsigned. Unsigned binaries must not be represented as SignPath-signed official releases.

## Purpose

Code signing is used to help users verify that an official Energy Home binary:

- belongs to the Energy Home project;
- originated from the project's controlled release process;
- has not been modified after signing.

A digital signature does not replace source review, malware scanning, checksum verification, or normal security testing.

## Team roles

### Authors / Committers

- **David Kobylka** — GitHub: [@kobyldav](https://github.com/kobyldav)

### Reviewers

- **David Kobylka** — GitHub: [@kobyldav](https://github.com/kobyldav)

Contributions from people who do not have direct commit rights must be reviewed by an authorized reviewer before they are merged.

### Approvers

- **David Kobylka** — GitHub: [@kobyldav](https://github.com/kobyldav)

An authorized approver is responsible for deciding whether a release is eligible for code signing.

Each official release-signing request must follow the approval requirements configured in SignPath.

## Source repository

Official Energy Home release artifacts must originate from the project's public source repository:

https://github.com/kobyldav/EnergyHome

Source code, build scripts, packaging configuration, and CI/CD definitions used for official releases are maintained in that repository.

## Trusted build process

Official SignPath-signed artifacts must be produced through the project's approved automated build workflow and the trusted build system configured for the SignPath project.

Release signing must not be used to sign arbitrary locally built binaries.

The intended release chain is:

```text
GitHub source repository
        ↓
GitHub Actions
        ↓
PyInstaller build
        ↓
SignPath signing process
        ↓
Windows installer build
        ↓
SignPath signing process
        ↓
GitHub Release
```

The exact workflow may evolve as the signing integration is implemented, while preserving SignPath's origin-verification and approval requirements.

## Release artifacts

Artifacts eligible for official signing may include:

```text
EnergyHome.exe
EnergyHome-<version>-Setup.exe
```

Where applicable, product and version metadata must correspond to the same Energy Home release version.

## Release approval

Before a release is approved for signing, the approver should verify that:

- the release originates from the official Energy Home repository;
- the intended commit/tag is correct;
- the automated build completed successfully;
- version metadata is correct;
- the application has passed appropriate functional testing;
- release artifacts do not contain private user data or development secrets;
- the release does not include unexpected or unauthorized components.

## Privacy policy

Energy Home's privacy policy is available here:

[PRIVACY.md](PRIVACY.md)

Energy Home follows the following principle:

> This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## Account security

Project members with access to source control or SignPath must use multi-factor authentication where required by the signing provider and repository platform.

Credentials, signing secrets, authentication tokens, and private keys must never be committed to the source repository.

## Changes to the signing infrastructure

Changes to files that can influence official builds or signing should receive particular attention, including:

- GitHub Actions workflows;
- PyInstaller configuration;
- installer configuration;
- dependency files;
- release scripts;
- SignPath integration files.

## Compromise response

If the project suspects that its source repository, CI/CD workflow, signing process, or official artifacts have been compromised:

1. release/signing activity should be paused where practical;
2. affected credentials or tokens should be revoked or rotated;
3. the incident should be investigated;
4. SignPath should be contacted when a signed artifact or signing process may be affected;
5. affected users should be informed when necessary;
6. corrected artifacts should be released only after the release chain has been re-established as trustworthy.
