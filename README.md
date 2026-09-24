<div align="center">

#  Energy Home

### Local energy and utility tracking for your home

Track electricity, gas, water, heating, meter readings, payments and consumption trends in one private desktop application.

[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows)](https://github.com/kobyldav/EnergyHome)
[![Python](https://img.shields.io/badge/Python-3.13+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/kobyldav/EnergyHome?include_prereleases)](https://github.com/kobyldav/EnergyHome/releases)

</div>

---

## About

**Energy Home** is a privacy-focused desktop application for keeping track of household energy consumption and utility costs.

It provides one place for recording and reviewing:

- electricity
- gas
- cold water
- hot water
- heating
- radiator heat meter readings
- utility advances
- fixed fees
- historical readings
- consumption trends

Energy Home is designed to work locally on your computer without requiring a cloud account or external database.

---

## Features

### Utility tracking

Maintain separate records for different household utilities:

-  Electricity
-  Gas
-  Cold water
-  Hot water
-  Heating
-  Individual radiator heat meters

Each utility can maintain its own readings, payments and related information.

### Meter readings

Record meter values over time and keep historical measurements available for later comparison.

This makes it possible to monitor changes in consumption instead of relying only on utility bills.

### Heating meters

Energy Home supports individual heat meters attached to radiators or heating units.

Readings from individual heating meters can be tracked separately and combined to represent overall heating consumption.

### Payments and fees

Keep track of:

- regular advance payments
- fixed utility fees
- utility-specific costs

This keeps consumption data and household energy payments in one place.

### Analytics

Historical data can be used to compare consumption over time and identify changes in household energy usage.

### Czech and English interface

The application supports:

- 🇨🇿 Czech
- 🇬🇧 English

The language can be switched directly from the application interface.

---

## Screenshots

Screenshots will be added as the interface continues to evolve.

<!--
Example for later:

![Energy Home dashboard](docs/images/dashboard.png)
-->

---

## Installation

### Windows

The recommended way to install Energy Home is using the Windows installer.

1. Open the [Releases](https://github.com/kobyldav/EnergyHome/releases) page.
2. Download the latest:

```text
EnergyHome-x.x.x-Setup.exe
```

3. Run the installer.
4. Start **Energy Home** from the Windows Start menu.

Python is **not required** when using the Windows installer.

---

## Data storage

Energy Home stores user data locally on the computer.

On Windows, application data is stored in:

```text
%LOCALAPPDATA%\EnergyHome
```

For example:

```text
C:\Users\<username>\AppData\Local\EnergyHome\
```

This directory contains the application's persistent user data.

Keeping data separate from the installed application means that updating the program does not overwrite your existing records.

### Privacy

Energy Home is designed as a local-first application.

Your household energy data is stored locally and is not intentionally uploaded to an external Energy Home server.

---

## How it works

Energy Home combines a Python backend with a web-based user interface.

```text
Energy Home
│
├── Python backend
│   ├── local HTTP server
│   ├── data storage
│   └── analytics
│
├── Frontend
│   ├── HTML
│   ├── CSS
│   └── JavaScript
│
└── Local user data
    └── %LOCALAPPDATA%\EnergyHome
```

The packaged Windows version includes the required Python runtime, so the user does not need to install Python separately.

---

## Project structure

```text
EnergyHome/
│
├── app.py
│
├── energy_app/
│   ├── __init__.py
│   ├── analytics.py
│   └── storage.py
│
├── static/
│   ├── app.js
│   ├── i18n.js
│   ├── styles.css
│   │
│   └── images/
│       └── icon.ico
│
├── templates/
│   └── index.html
│
├── EnergyHome.spec
├── installer.iss
├── requirements-build.txt
│
├── README.md
└── LICENSE
```

Build-generated directories such as `build/`, `dist/`, `.venv/` and `release/` are not intended to be committed to the repository.

---

## Running from source

### Requirements

- Python 3.13 or newer
- Windows 10 or Windows 11

Clone the repository:

```bash
git clone https://github.com/kobyldav/EnergyHome.git
cd EnergyHome
```

Run the application:

```bash
python app.py
```

The application starts a local server and opens the Energy Home interface.

---

## Building the Windows application

Energy Home uses [PyInstaller](https://pyinstaller.org/) to package the Python application.

Create a virtual environment:

```powershell
py -3 -m venv .venv
```

Activate it:

```powershell
.venv\Scripts\activate
```

Install build dependencies:

```powershell
python -m pip install -r requirements-build.txt
```

Build the application:

```powershell
python -m PyInstaller --noconfirm --clean EnergyHome.spec
```

The generated application will be available in:

```text
dist\EnergyHome\
```

---

## Building the installer

The Windows installer is created using [Inno Setup](https://jrsoftware.org/isinfo.php).

After building the application, compile:

```text
installer.iss
```

The resulting installer is created as:

```text
EnergyHome-x.x.x-Setup.exe
```

Release builds can also include a SHA-256 checksum for integrity verification.

---

## Security and code signing

Official Windows releases are intended to be digitally signed.

The project is being prepared to use free code signing for eligible open-source software through:

- [SignPath.io](https://signpath.io/)
- [SignPath Foundation](https://signpath.org/)

The goal is to ensure that users can verify that official Energy Home binaries originate from the project's trusted build process and have not been modified after signing.

### Code signing policy

Free code signing is provided by **SignPath.io**, with a certificate provided by the **SignPath Foundation**.

Only binaries generated from the official Energy Home source repository and approved release workflow are eligible to be published as official releases.

More detailed signing and release policies may be documented separately as the automated release infrastructure is introduced.

---

## Release integrity

Release downloads may include a SHA-256 checksum file:

```text
EnergyHome-x.x.x-Setup.exe.sha256.txt
```

On Windows, the installer checksum can be verified with:

```powershell
Get-FileHash .\EnergyHome-x.x.x-Setup.exe -Algorithm SHA256
```

Compare the resulting hash with the value published alongside the release.

---

## Roadmap

Planned areas of development include:

- improved consumption analytics
- better historical comparisons
- expanded heating analysis
- import and export tools
- improved backup and restore
- automated Windows builds
- automated signed releases
- easier application updates

The roadmap may change as the application evolves.

---

## Contributing

Contributions, bug reports and suggestions are welcome.

If you find a problem, please open a GitHub Issue and include:

- a description of the problem
- steps to reproduce it
- your Windows version
- the Energy Home version
- relevant error information, if available

For larger changes, opening an issue before submitting a pull request is recommended.

---

## Privacy and security

Energy and household consumption information can be sensitive.

Energy Home therefore follows a local-first design:

- data is stored locally
- no Energy Home account is required
- no cloud database is required for normal operation
- application files and user data are stored separately

Do not include personal energy data when submitting public bug reports.

---

## License

Energy Home is licensed under the **MIT License**.

See [LICENSE](LICENSE) for details.

---

## Author

Developed by **David Kobylka**.

GitHub: [@kobyldav](https://github.com/kobyldav)

---

<div align="center">

**Energy Home**

Simple household energy tracking.  
Local data. Clear overview. Full control.

</div>
