$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$unpackedDirectory = Join-Path $projectRoot 'dist\win-unpacked'
$executable = Get-ChildItem -LiteralPath $unpackedDirectory -Filter '*.exe' -File |
  Sort-Object Length -Descending |
  Select-Object -First 1

if (-not $executable) {
  throw 'Packaged executable is missing.'
}

$process = Start-Process -FilePath $executable.FullName `
  -ArgumentList '--launch-probe' `
  -WorkingDirectory $unpackedDirectory `
  -WindowStyle Hidden `
  -PassThru

if (-not $process.WaitForExit(20000)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw 'Packaged executable did not finish its launch probe within 20 seconds.'
}

if ($process.ExitCode -ne 0) {
  $unsignedExitCode = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$process.ExitCode), 0)
  $hexExitCode = '{0:X8}' -f $unsignedExitCode
  throw "Packaged executable failed its launch probe: $($process.ExitCode) (0x$hexExitCode)."
}

Write-Output "Packaged launch probe passed: $($executable.FullName)"
