# Privacy Policy

_Last updated: September 24, 2026_

## Overview

Energy Home is a local-first desktop application for tracking household energy and utility data.

The application is designed so that normal use does not require an Energy Home account, a cloud database, or an Energy Home-operated remote server.

## Data stored by Energy Home

Energy Home may store information entered by the user, including:

- electricity readings;
- gas readings;
- hot and cold water readings;
- heating readings;
- individual radiator heat meter readings;
- advance payments;
- fixed fees;
- other household utility information entered into the application.

On Windows, persistent application data is stored locally under:

```text
%LOCALAPPDATA%\EnergyHome
```

For example:

```text
C:\Users\<username>\AppData\Local\EnergyHome
```

## Network communication

Energy Home runs a local HTTP server bound to the local computer for communication between its Python backend and its user interface.

The current application is designed to use the loopback interface for this local communication and does not intentionally transmit household energy data to an Energy Home-operated remote service.

**This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.**

Actions explicitly requested by the user may cause other applications or services to be opened, for example following an external link to GitHub. Those external services are governed by their own privacy policies.

## Telemetry and analytics

The current version of Energy Home does not include application telemetry, advertising trackers, or an Energy Home cloud analytics service.

## Data sharing

Energy Home does not sell user data.

Because household data is stored locally, the user controls the files on their computer and is responsible for any copies, backups, exports, or files they choose to share.

## Data retention and deletion

Energy Home data remains on the local computer until the user changes or deletes it.

Uninstalling the application may intentionally leave the user data directory in place so that application updates or reinstallations do not destroy historical records.

To remove the local Energy Home data manually, the user can delete:

```text
%LOCALAPPDATA%\EnergyHome
```

The user should make a backup first if the data may be needed later.

## Security

Energy and household consumption information can be sensitive. Users should avoid including their personal Energy Home data in public GitHub issues or other public reports.

Security issues should be reported according to [SECURITY.md](SECURITY.md).

## Changes to this policy

This privacy policy may be updated when Energy Home gains new functionality that changes how data is stored, processed, or transmitted.

## Contact

For project questions, use the Energy Home GitHub repository:

https://github.com/kobyldav/EnergyHome
