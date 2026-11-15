[Setup]
AppId={{C18261F0-B689-4D53-A9AD-45FA82699FE7}
AppName=Orbit
AppVersion=3.0.0
AppPublisher=tihomirovsmile
AppPublisherURL=https://github.com/tihomirovsmile/orbit
AppSupportURL=https://github.com/tihomirovsmile/orbit
AppCopyright=Copyright (c) 2026 tihomirovsmile
DefaultDirName={localappdata}\Programs\Orbit
DefaultGroupName=Orbit
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableWelcomePage=no
DisableDirPage=no
LicenseFile=..\LICENSE
InfoBeforeFile=..\SUPPORT.md
OutputDir=..\releases
OutputBaseFilename=Orbit-Setup-3.0.0
SetupIconFile=..\build\desktop\Orbit.ico
UninstallDisplayIcon={app}\Orbit.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
AppMutex=OrbitInstaller

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"; Flags: unchecked

[Files]
Source: "..\build\desktop\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Orbit"; Filename: "{app}\Orbit.exe"; IconFilename: "{app}\Orbit.ico"
Name: "{group}\Настройки запуска Orbit"; Filename: "{app}\Orbit.exe"; Parameters: "--settings"; IconFilename: "{app}\Orbit.ico"
Name: "{autodesktop}\Orbit"; Filename: "{app}\Orbit.exe"; IconFilename: "{app}\Orbit.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\Orbit.exe"; Description: "Открыть Orbit"; Flags: nowait postinstall skipifsilent

[Code]
var
  ModePage: TInputOptionWizardPage;
  AskMode: TNewCheckBox;

function DataHome: String;
begin
  Result := ExpandConstant('{param:DATAHOME|{localappdata}\Orbit}');
end;

procedure InitializeWizard;
var Existing: AnsiString;
begin
  ModePage := CreateInputOptionPage(wpSelectTasks, 'Запуск Orbit', 'Как открывать Orbit?', 'Настройки можно изменить в приложении в любой момент.', True, False);
  ModePage.Add('Отдельное окно приложения (Edge / Chrome)');
  ModePage.Add('В браузере на этом компьютере');
  ModePage.Add('В браузере с доступом в локальной сети');
  ModePage.SelectedValueIndex := 0;
  AskMode := TNewCheckBox.Create(ModePage);
  AskMode.Parent := ModePage.Surface;
  AskMode.Caption := 'Спрашивать режим при каждом запуске';
  AskMode.Top := ScaleY(110);
  AskMode.Width := ModePage.SurfaceWidth;
  AskMode.Checked := True;
  if LoadStringFromFile(DataHome + '\launcher.ini', Existing) then begin
    if Pos('mode=local', String(Existing)) > 0 then ModePage.SelectedValueIndex := 1;
    if Pos('mode=lan', String(Existing)) > 0 then ModePage.SelectedValueIndex := 2;
    AskMode.Checked := Pos('ask=false', String(Existing)) = 0;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Mode, Ask: String;
begin
  if CurStep = ssPostInstall then begin
    Mode := 'app';
    if ModePage.SelectedValueIndex = 1 then Mode := 'local';
    if ModePage.SelectedValueIndex = 2 then Mode := 'lan';
    Ask := 'true';
    if not AskMode.Checked then Ask := 'false';
    ForceDirectories(DataHome);
    if not SaveStringToFile(DataHome + '\launcher.ini', 'mode=' + Mode + #10 + 'ask=' + Ask + #10, False) then
      RaiseException('Не удалось сохранить настройки запуска Orbit.');
  end;
end;
