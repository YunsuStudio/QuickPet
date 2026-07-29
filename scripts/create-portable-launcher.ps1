$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw -Encoding UTF8 (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$distDirectory = Join-Path $projectRoot 'dist'
$unpackedDirectory = Join-Path $distDirectory 'win-unpacked'
$asarPath = Join-Path $unpackedDirectory 'resources\app.asar'
if (-not (Test-Path -LiteralPath $asarPath)) {
  throw 'win-unpacked is missing. Run npm run pack first.'
}

$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  throw 'The Windows .NET Framework C# compiler is unavailable.'
}

$stageDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "QuickPetPortableBuild-$PID"
$archivePath = Join-Path $stageDirectory 'quickpet.zip'
$sourcePath = Join-Path $stageDirectory 'PortableLauncher.cs'
$compiledPath = Join-Path $stageDirectory 'QuickPet-Portable.exe'
$finalOutput = Join-Path $distDirectory "QuickPet-Portable-$($package.version)-x64.exe"
New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null

try {
  Compress-Archive -Path (Join-Path $unpackedDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal -Force
  $payloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
  $payloadId = $payloadHash.Substring(0, 16).ToLowerInvariant()
  $numericVersion = if ($package.version -match '^\d+\.\d+\.\d+$') { "$($package.version).0" } else { '1.0.0.0' }

  $source = @"
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Quick Pet Portable")]
[assembly: AssemblyProduct("Quick Pet Portable")]
[assembly: AssemblyDescription("Portable launcher for Quick Pet")]
[assembly: AssemblyVersion("$numericVersion")]
[assembly: AssemblyFileVersion("$numericVersion")]

internal static class PortableLauncher
{
    private const string Magic = "QUICKPETPORTABLE";
    private const int FooterLength = 24;
    private const string AppVersion = "$($package.version)";
    private const string PayloadId = "$payloadId";

    [STAThread]
    private static int Main(string[] args)
    {
        bool verifyMode = args.Length > 0 && String.Equals(args[0], "--verify", StringComparison.OrdinalIgnoreCase);
        try
        {
            string cacheDirectory = EnsureExtracted();
            string application = FindApplication(cacheDirectory);
            if (verifyMode)
            {
                if (!File.Exists(application) || !File.Exists(Path.Combine(cacheDirectory, "resources", "app.asar")))
                {
                    return 2;
                }
                ProcessStartInfo probeInfo = CreateStartInfo(application, cacheDirectory);
                probeInfo.Arguments = "--launch-probe";
                using (Process probe = Process.Start(probeInfo))
                {
                    if (probe == null)
                    {
                        return 3;
                    }
                    if (!probe.WaitForExit(20000))
                    {
                        probe.Kill();
                        return 4;
                    }
                    return probe.ExitCode;
                }
            }

            using (FileStream runningLock = OpenRunningLock(cacheDirectory))
            using (Process applicationProcess = Process.Start(CreateStartInfo(application, cacheDirectory)))
            {
                if (applicationProcess == null)
                {
                    throw new InvalidOperationException("Quick Pet could not start.");
                }
                applicationProcess.WaitForExit();
            }
            return 0;
        }
        catch (Exception error)
        {
            if (verifyMode)
            {
                return 1;
            }
            MessageBox.Show(
                "快捷宠便携版无法启动。\r\n\r\n请把便携 EXE 移动到桌面或其他有写入权限的文件夹。\r\n运行文件会解压到 EXE 旁的 QuickPet-Portable-Cache。\r\n\r\n" + error.Message,
                "快捷宠便携版",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static ProcessStartInfo CreateStartInfo(string application, string cacheDirectory)
    {
        Environment.SetEnvironmentVariable("PORTABLE_EXECUTABLE_FILE", Application.ExecutablePath);
        Environment.SetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR", Path.GetDirectoryName(Application.ExecutablePath));
        Environment.SetEnvironmentVariable("QUICKPET_PORTABLE", "1");
        Environment.SetEnvironmentVariable("QUICKPET_PORTABLE_CACHE_ROOT", Path.GetDirectoryName(cacheDirectory));
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = application;
        startInfo.WorkingDirectory = cacheDirectory;
        startInfo.UseShellExecute = false;
        return startInfo;
    }

    private static FileStream OpenRunningLock(string cacheDirectory)
    {
        string marker = Path.Combine(cacheDirectory, ".running");
        if (!File.Exists(marker))
        {
            File.WriteAllText(marker, AppVersion, Encoding.ASCII);
        }
        return new FileStream(marker, FileMode.Open, FileAccess.Read, FileShare.Read);
    }

    private static string EnsureExtracted()
    {
        string root = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "QuickPet-Portable-Cache");
        string cacheDirectory = Path.Combine(root, AppVersion + "-" + PayloadId);
        string marker = Path.Combine(cacheDirectory, ".complete");
        Directory.CreateDirectory(root);

        using (Mutex mutex = new Mutex(false, "Local\\QuickPetPortable-" + PayloadId))
        {
            try
            {
                mutex.WaitOne();
            }
            catch (AbandonedMutexException)
            {
            }

            try
            {
                if (File.Exists(marker))
                {
                    return cacheDirectory;
                }

                if (Directory.Exists(cacheDirectory))
                {
                    Directory.Delete(cacheDirectory, true);
                }

                string stagingDirectory = cacheDirectory + ".extracting-" + Process.GetCurrentProcess().Id;
                string temporaryArchive = Path.Combine(root, PayloadId + ".zip");
                if (Directory.Exists(stagingDirectory))
                {
                    Directory.Delete(stagingDirectory, true);
                }

                try
                {
                    CopyEmbeddedArchive(temporaryArchive);
                    ZipFile.ExtractToDirectory(temporaryArchive, stagingDirectory);
                    File.WriteAllText(Path.Combine(stagingDirectory, ".complete"), PayloadId, Encoding.ASCII);
                    Directory.Move(stagingDirectory, cacheDirectory);
                }
                finally
                {
                    if (File.Exists(temporaryArchive))
                    {
                        File.Delete(temporaryArchive);
                    }
                    if (Directory.Exists(stagingDirectory))
                    {
                        Directory.Delete(stagingDirectory, true);
                    }
                }

                return cacheDirectory;
            }
            finally
            {
                mutex.ReleaseMutex();
            }
        }
    }

    private static void CopyEmbeddedArchive(string targetPath)
    {
        using (FileStream source = new FileStream(Application.ExecutablePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (source.Length < FooterLength)
            {
                throw new InvalidDataException("The portable payload is missing.");
            }

            source.Seek(-FooterLength, SeekOrigin.End);
            byte[] footer = new byte[FooterLength];
            ReadExactly(source, footer, 0, footer.Length);
            long archiveLength = BitConverter.ToInt64(footer, 0);
            string magic = Encoding.ASCII.GetString(footer, 8, 16);
            long archiveOffset = source.Length - FooterLength - archiveLength;
            if (magic != Magic || archiveLength <= 0 || archiveOffset < 0)
            {
                throw new InvalidDataException("The portable payload is invalid.");
            }

            source.Position = archiveOffset;
            using (FileStream target = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                byte[] buffer = new byte[1024 * 1024];
                long remaining = archiveLength;
                while (remaining > 0)
                {
                    int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0)
                    {
                        throw new EndOfStreamException("The portable payload ended unexpectedly.");
                    }
                    target.Write(buffer, 0, read);
                    remaining -= read;
                }
            }
        }
    }

    private static string FindApplication(string directory)
    {
        string application = Directory.GetFiles(directory, "*.exe", SearchOption.TopDirectoryOnly)
            .OrderByDescending(path => new FileInfo(path).Length)
            .FirstOrDefault();
        if (String.IsNullOrEmpty(application))
        {
            throw new FileNotFoundException("The Quick Pet application was not found in the portable cache.");
        }
        return application;
    }

    private static void ReadExactly(Stream stream, byte[] buffer, int offset, int count)
    {
        while (count > 0)
        {
            int read = stream.Read(buffer, offset, count);
            if (read <= 0)
            {
                throw new EndOfStreamException();
            }
            offset += read;
            count -= read;
        }
    }
}
"@
  Set-Content -LiteralPath $sourcePath -Value $source -Encoding UTF8

  $frameworkDirectory = Split-Path -Parent $compiler
  $references = @(
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Windows.Forms.dll',
    "/reference:$frameworkDirectory\System.IO.Compression.dll",
    "/reference:$frameworkDirectory\System.IO.Compression.FileSystem.dll"
  )
  $compilerArguments = @(
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    "/out:$compiledPath",
    "/win32icon:$(Join-Path $projectRoot 'assets\app-icon.ico')"
  ) + $references + @($sourcePath)
  $compilerOutput = & $compiler @compilerArguments 2>&1
  $compilerExitCode = $LASTEXITCODE
  if ($compilerExitCode -ne 0 -or -not (Test-Path -LiteralPath $compiledPath)) {
    throw "Portable launcher compilation failed with exit code $compilerExitCode.`n$($compilerOutput -join [Environment]::NewLine)"
  }

  $outputStream = [System.IO.File]::Open($compiledPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    $archiveStream = [System.IO.File]::OpenRead($archivePath)
    try {
      $archiveStream.CopyTo($outputStream)
      $writer = New-Object System.IO.BinaryWriter($outputStream, [System.Text.Encoding]::ASCII, $true)
      try {
        $writer.Write([Int64]$archiveStream.Length)
        $writer.Write([System.Text.Encoding]::ASCII.GetBytes('QUICKPETPORTABLE'))
      } finally {
        $writer.Dispose()
      }
    } finally {
      $archiveStream.Dispose()
    }
  } finally {
    $outputStream.Dispose()
  }

  Move-Item -LiteralPath $compiledPath -Destination $finalOutput -Force
  Write-Output $finalOutput
} finally {
  if (Test-Path -LiteralPath $stageDirectory) {
    Remove-Item -LiteralPath $stageDirectory -Recurse -Force
  }
}
