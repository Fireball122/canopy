; =====================================================================
; Canopy Windows Setup Wizard (Inno Setup 6 Script)
; Generates branded, showcase-grade Canopy-v1.0.0-Setup.exe
; =====================================================================

#define MyAppName "Canopy"
#ifndef MyAppVersion
#define MyAppVersion "1.0.5"
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
DefaultDirName={userpf}\{#MyAppName}
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
// Helper to detect if Microsoft Edge WebView2 runtime is installed on the machine
function IsWebView2Installed(): Boolean;
var
  InstalledVersion: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', InstalledVersion) or
            RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', InstalledVersion) or
            RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', InstalledVersion);
  if Result and (InstalledVersion = '0.0.0.0') then
    Result := False;
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
  BootstrapperPath: String;
  DownloadUrl: String;
begin
  Result := True;

  // Terminate any running Canopy instance before proceeding
  ShellExec('open', 'taskkill.exe', '/f /im Canopy.exe', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);

  // Check if WebView2 runtime is missing
  if not IsWebView2Installed() then
  begin
    if MsgBox('Canopy requires the Microsoft Edge WebView2 Runtime to display its interface.'#13#10#13#10 +
              'Would you like Setup to download and install the official Microsoft WebView2 Runtime now?',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      BootstrapperPath := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
      DownloadUrl := 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
      
      // Download via PowerShell
      if ShellExec('open', 'powershell.exe',
                   '-NoProfile -Command "Invoke-WebRequest -Uri ''' + DownloadUrl + ''' -OutFile ''' + BootstrapperPath + '''"',
                   '', SW_HIDE, ewWaitUntilTerminated, ErrorCode) and (ErrorCode = 0) then
      begin
        // Silently run the Evergreen bootstrapper
        ShellExec('open', BootstrapperPath, '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, ErrorCode);
      end
      else
      begin
        MsgBox('Unable to automatically download the WebView2 bootstrapper.'#13#10 +
               'Please install it manually from https://go.microsoft.com/fwlink/p/?LinkId=2124703 before launching Canopy.',
               mbInformation, MB_OK);
      end;
    end;
  end;
end;

function InitializeUninstall(): Boolean;
var
  ErrorCode: Integer;
begin
  // Terminate any running Canopy instance before uninstalling so files are cleanly removed
  ShellExec('open', 'taskkill.exe', '/f /im Canopy.exe', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
  Result := True;
end;
