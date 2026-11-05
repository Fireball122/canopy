; =====================================================================
; Canopy Windows Setup Wizard (Inno Setup 6 Script)
; Generates branded, showcase-grade Canopy-v<version>-Setup.exe.
; Build via installer\build-setup-exe.ps1, which passes the version from Canopy.csproj.
; =====================================================================

#define MyAppName "Canopy"
#ifndef MyAppVersion
  #error MyAppVersion is not defined. Build with installer\build-setup-exe.ps1 (it reads Canopy.csproj).
#endif
#define MyAppPublisher "Canopy Shell"
#define MyAppURL "https://github.com/Fireball122/canopy"
#define MyAppExeName "Canopy.exe"
#ifndef MySourceDir
  #define MySourceDir "..\bin\Release\net8.0-windows10.0.19041.0\publish-msi"
#endif

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
const
  WebView2ClientKey = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2BootstrapperUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

// Helper to detect if Microsoft Edge WebView2 runtime is installed on the machine
function IsWebView2Installed(): Boolean;
var
  InstalledVersion: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2ClientKey, 'pv', InstalledVersion) or
            RegQueryStringValue(HKCU, 'SOFTWARE\' + WebView2ClientKey, 'pv', InstalledVersion) or
            RegQueryStringValue(HKLM, 'SOFTWARE\' + WebView2ClientKey, 'pv', InstalledVersion);
  if Result and ((InstalledVersion = '') or (InstalledVersion = '0.0.0.0')) then
    Result := False;
end;

procedure CloseRunningCanopy();
var
  ErrorCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
  BootstrapperPath: String;
begin
  Result := True;

  // Check if WebView2 runtime is missing. SuppressibleMsgBox answers IDYES under /SUPPRESSMSGBOXES,
  // so unattended installs fetch the runtime instead of blocking on a dialog nobody can see.
  if not IsWebView2Installed() then
  begin
    if SuppressibleMsgBox('Canopy requires the Microsoft Edge WebView2 Runtime to display its interface.'#13#10#13#10 +
              'Would you like Setup to download and install the official Microsoft WebView2 Runtime now?',
              mbConfirmation, MB_YESNO, IDYES) = IDYES then
    begin
      BootstrapperPath := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');

      // Download via PowerShell. TLS 1.2 is forced because Windows PowerShell 5.1 on older Windows 10
      // builds still offers TLS 1.0 only, which go.microsoft.com rejects; the progress bar is
      // disabled because it slows Invoke-WebRequest down by an order of magnitude.
      if Exec('powershell.exe',
              '-NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = ''SilentlyContinue''; ' +
              '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; ' +
              'Invoke-WebRequest -UseBasicParsing -Uri ''' + WebView2BootstrapperUrl + ''' -OutFile ''' + BootstrapperPath + '''"',
              '', SW_HIDE, ewWaitUntilTerminated, ErrorCode) and (ErrorCode = 0) and FileExists(BootstrapperPath) then
      begin
        // Silently run the Evergreen bootstrapper
        Exec(BootstrapperPath, '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, ErrorCode);
        if not IsWebView2Installed() then
          SuppressibleMsgBox('The WebView2 Runtime installation did not complete (exit code ' + IntToStr(ErrorCode) + ').'#13#10 +
                 'Canopy cannot display its panel until the runtime is installed from ' + WebView2BootstrapperUrl,
                 mbError, MB_OK, IDOK);
      end
      else
      begin
        SuppressibleMsgBox('Unable to automatically download the WebView2 bootstrapper.'#13#10 +
               'Please install it manually from ' + WebView2BootstrapperUrl + ' before launching Canopy.',
               mbInformation, MB_OK, IDOK);
      end;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  // Terminate a running Canopy only once the user has committed to installing, so cancelling the
  // wizard leaves the running instance alone.
  CloseRunningCanopy();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  // Terminate any running Canopy instance before uninstalling so files are cleanly removed
  CloseRunningCanopy();
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  RunValue: String;
  DataDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Canopy's own "Start with Windows" setting writes the same Run value as the startupentry task.
    // Remove it when it points into this install, otherwise Windows keeps a dead startup entry.
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Canopy', RunValue) and
       (Pos(Lowercase(ExpandConstant('{app}')), Lowercase(RunValue)) > 0) then
      RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Canopy');
  end
  else if CurUninstallStep = usPostUninstall then
  begin
    // Settings, logs, thumbnails and the WebView2 profile live in %LOCALAPPDATA%\Canopy. They are kept
    // unless the user opts in (silent uninstalls keep them); the folder is skipped entirely if an old
    // portable copy of Canopy.exe was unpacked there.
    DataDir := ExpandConstant('{localappdata}\Canopy');
    if DirExists(DataDir) and not FileExists(DataDir + '\{#MyAppExeName}') then
    begin
      if SuppressibleMsgBox('Also remove Canopy settings, logs and cached data?'#13#10#13#10 + DataDir,
                            mbConfirmation, MB_YESNO, IDNO) = IDYES then
      begin
        DelTree(DataDir, True, True, True);
        RegDeleteValue(HKCU, 'Software\CanopyShell\Canopy', 'ShowPanelOnLaunch');
        RegDeleteKeyIfEmpty(HKCU, 'Software\CanopyShell\Canopy');
      end;
    end;
  end;
end;
