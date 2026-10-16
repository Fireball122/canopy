; =====================================================================
; Canopy Windows Setup Wizard (Inno Setup 6 Script)
; Generates branded, showcase-grade Canopy-v1.0.0-Setup.exe
; =====================================================================

#define MyAppName "Canopy"
#ifndef MyAppVersion
#define MyAppVersion "1.0.2"
#endif
#define MyAppPublisher "Canopy Shell"
#define MyAppURL "https://github.com/Fireball122/canopy"
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
UninstallDisplayIcon={app}\app.ico
UninstallDisplayName={#MyAppName} Control Center
WizardImageFile=wizard_banner.bmp
WizardSmallImageFile=wizard_logo.bmp
InfoBeforeFile=info.txt
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64compatible

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
Name: "{autoprograms}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"; IconFilename: "{app}\app.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\app.ico"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Canopy"; ValueData: """{app}\{#MyAppExeName}"" --hidden"; Flags: uninsdeletevalue; Tasks: startupentry

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\*.log"
Type: files; Name: "{app}\*.tmp"
Type: filesandordirs; Name: "{app}\dist"

[Code]
function InitializeUninstall(): Boolean;
var
  ErrorCode: Integer;
begin
  // Terminate any running Canopy instance before uninstalling so files are cleanly removed
  ShellExec('open', 'taskkill.exe', '/f /im Canopy.exe', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
  Result := True;
end;
