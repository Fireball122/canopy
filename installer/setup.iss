; =====================================================================
; Canopy Windows Setup Wizard (Inno Setup 6 Script)
; Generates branded, showcase-grade Canopy-v1.0.0-Setup.exe
; =====================================================================

#define MyAppName "Canopy"
#ifndef MyAppVersion
#define MyAppVersion "1.0.1"
#endif
#define MyAppPublisher "Canopy Shell"
#define MyAppURL "https://github.com/canopy-shell/canopy"
#define MyAppExeName "Canopy.exe"
#define MySourceDir "..\bin\Release\net8.0-windows10.0.19041.0\publish-msi"

[Setup]
AppId={{5E2189CD-B0E3-4019-8664-9A4B3BC32F01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={userpf}\Programs\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-installer
OutputBaseFilename=Canopy-v{#MyAppVersion}-Setup
SetupIconFile=..\app.ico
WizardImageFile=wizard_banner.bmp
WizardSmallImageFile=wizard_logo.bmp
InfoBeforeFile=info.txt
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardResizable=no
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to [name]
WelcomeLabel2=This wizard will install [name] — the fluid, zero-notch top hover desktop control center on your computer.%n%nIt is recommended that you close any other applications before continuing.
ClickNext=Click Next to learn more, or Cancel to exit Setup.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startupentry"; Description: "Start Canopy when Windows boots"; GroupDescription: "Windows Integration:"

[Files]
Source: "{#MySourceDir}\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\app.ico"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Canopy"; ValueData: """{app}\{#MyAppExeName}"" --hidden"; Flags: uninsdeletevalue; Tasks: startupentry

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
