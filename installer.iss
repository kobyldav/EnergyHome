#define MyAppName "Energy Home"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "KobylDav"
#define MyAppURL "https://github.com/kobyldav/EnergyHome"
#define MyAppExeName "EnergyHome.exe"

[Setup]
AppId={{B9352C6E-8D50-4B0A-8EF2-77B4E6879E41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\Energy Home
DefaultGroupName=Energy Home
DisableProgramGroupPage=yes
PrivilegesRequired=lowest

; Compatible with Inno Setup 6.3+ and Inno Setup 7.
; EnergyHome.exe is x64, so only x64-capable Windows is allowed
; and the installer uses 64-bit install mode on those systems.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

OutputDir=release
OutputBaseFilename=EnergyHome-{#MyAppVersion}-Setup
SetupIconFile=static\images\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
MinVersion=10.0
VersionInfoVersion=1.0.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Energy Home installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "czech"; MessagesFile: "compiler:Languages\Czech.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\EnergyHome\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Energy Home"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\Energy Home"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,Energy Home}"; Flags: nowait postinstall skipifsilent
