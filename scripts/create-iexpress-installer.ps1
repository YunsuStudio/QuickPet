$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw -Encoding UTF8 (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$distDirectory = Join-Path $projectRoot 'dist'
$unpackedDirectory = Join-Path $distDirectory 'win-unpacked'
if (-not (Test-Path -LiteralPath (Join-Path $unpackedDirectory 'resources\app.asar'))) {
  throw 'win-unpacked is missing. Run npm run pack first.'
}

$stageDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "QuickPetIExpress-$PID"
$iexpressOutput = Join-Path $stageDirectory 'QuickPet-Setup.exe'
$finalOutput = Join-Path $distDirectory "QuickPet-Setup-$($package.version)-x64.exe"
New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null

try {
  $archivePath = Join-Path $stageDirectory 'quickpet.zip'
  Compress-Archive -Path (Join-Path $unpackedDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal -Force

  $installScript = @'
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\QuickPet'
$archive = Join-Path $PSScriptRoot 'quickpet.zip'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$executable = Get-ChildItem -LiteralPath $destination -Filter '*.exe' -File | Sort-Object Length -Descending | Select-Object -First 1
if (-not $executable) { throw 'QuickPet executable was not installed.' }
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if (-not $folder) { continue }
  $shortcut = $shell.CreateShortcut((Join-Path $folder ($executable.BaseName + '.lnk')))
  $shortcut.TargetPath = $executable.FullName
  $shortcut.WorkingDirectory = $destination
  $shortcut.IconLocation = $executable.FullName + ',0'
  $shortcut.Description = 'Quick Pet launcher'
  $shortcut.Save()
}
Start-Process -FilePath $executable.FullName -WorkingDirectory $destination
'@
  Set-Content -LiteralPath (Join-Path $stageDirectory 'install.ps1') -Value $installScript -Encoding ASCII

  $stageWithSlash = $stageDirectory.TrimEnd('\') + '\'
  $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$iexpressOutput
FriendlyName=Quick Pet $($package.version)
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="quickpet.zip"
FILE1="install.ps1"
[SourceFiles]
SourceFiles0=$stageWithSlash
[SourceFiles0]
%FILE0%=
%FILE1%=
"@
  $sedPath = Join-Path $stageDirectory 'quickpet.sed'
  Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII
  $process = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\iexpress.exe') -ArgumentList @('/N', '/Q', $sedPath) -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $iexpressOutput)) {
    throw "IExpress failed with exit code $($process.ExitCode)"
  }
  Move-Item -LiteralPath $iexpressOutput -Destination $finalOutput -Force
  Write-Output $finalOutput
} finally {
  if (Test-Path -LiteralPath $stageDirectory) {
    Remove-Item -LiteralPath $stageDirectory -Recurse -Force
  }
}
