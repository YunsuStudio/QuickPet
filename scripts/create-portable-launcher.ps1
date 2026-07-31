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
using System.Collections.Generic;
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
[assembly: AssemblyCompany("\u4e91\u95f4\u6eaf\u5de5\u4f5c\u5ba4")]
[assembly: AssemblyCopyright("Copyright \u00a9 2026 \u4e91\u95f4\u6eaf\u5de5\u4f5c\u5ba4")]
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
            if (!verifyMode && TryLaunchNewerPortable(args))
            {
                return 0;
            }
            if (!verifyMode)
            {
                EnsureNoNewerCacheVersion();
                DisableOlderPortableLaunchers();
            }
            string cacheDirectory = EnsureExtracted();
            string application = FindApplication(cacheDirectory);
            if (verifyMode)
            {
                if (!File.Exists(application) || !File.Exists(Path.Combine(cacheDirectory, "resources", "app.asar")))
                {
                    return 2;
                }
                ProcessStartInfo probeInfo = CreateStartInfo(application, cacheDirectory, new string[] { "--launch-probe" });
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

            string[] staleCaches = QuarantineStaleCaches(cacheDirectory);
            using (FileStream runningLock = OpenRunningLock(cacheDirectory))
            using (Process applicationProcess = Process.Start(CreateStartInfo(application, cacheDirectory, args)))
            {
                if (applicationProcess == null)
                {
                    throw new InvalidOperationException("Quick Pet could not start.");
                }
                DeleteQuarantinedCaches(staleCaches);
                applicationProcess.WaitForExit();
            }
            return 0;
        }
        catch (Exception error)
        {
            WriteDiagnostic("startup", error, Application.ExecutablePath);
            if (verifyMode)
            {
                return 1;
            }
            MessageBox.Show(
                "\u5feb\u6377\u5ba0\u4fbf\u643a\u7248\u65e0\u6cd5\u542f\u52a8\u3002\r\n\r\n\u8bf7\u628a\u4fbf\u643a EXE \u79fb\u52a8\u5230\u684c\u9762\u6216\u5176\u4ed6\u6709\u5199\u5165\u6743\u9650\u7684\u6587\u4ef6\u5939\u3002\r\n\u8fd0\u884c\u6587\u4ef6\u4f1a\u89e3\u538b\u5230 EXE \u65c1\u7684 QuickPet-Portable-Cache\u3002\r\n\u8bca\u65ad\u65e5\u5fd7\u4f4d\u4e8e EXE \u540c\u76ee\u5f55\uff0c\u76ee\u5f55\u4e0d\u53ef\u5199\u65f6\u4f4d\u4e8e\u672c\u673a AppData\\Local\\QuickPet\u3002\r\n\r\n" + error.Message,
                "\u5feb\u6377\u5ba0\u4fbf\u643a\u7248",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static ProcessStartInfo CreateStartInfo(string application, string cacheDirectory, string[] arguments)
    {
        Environment.SetEnvironmentVariable("PORTABLE_EXECUTABLE_FILE", Application.ExecutablePath);
        Environment.SetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR", Path.GetDirectoryName(Application.ExecutablePath));
        Environment.SetEnvironmentVariable("QUICKPET_PORTABLE", "1");
        Environment.SetEnvironmentVariable("QUICKPET_PORTABLE_CACHE_ROOT", Path.GetDirectoryName(cacheDirectory));
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = application;
        startInfo.Arguments = String.Join(" ", (arguments ?? new string[0]).Select(QuoteArgument));
        startInfo.WorkingDirectory = cacheDirectory;
        startInfo.UseShellExecute = false;
        return startInfo;
    }

    private static string QuoteArgument(string argument)
    {
        if (String.IsNullOrEmpty(argument)) return "\"\"";
        return argument.Contains(" ") || argument.Contains("\"")
            ? "\"" + argument.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
            : argument;
    }

    private static string[] DiagnosticLogPaths()
    {
        return new string[]
        {
            Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "QuickPet-Portable.log"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuickPet", "QuickPet-Portable.log")
        };
    }

    private static void WriteDiagnostic(string operation, Exception error, string target)
    {
        string safeTarget = (target ?? String.Empty).Replace("\r", " ").Replace("\n", " ");
        string line = DateTime.UtcNow.ToString("o") + " [" + operation + "] " + safeTarget + Environment.NewLine + error + Environment.NewLine;
        foreach (string logPath in DiagnosticLogPaths())
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(logPath));
                if (File.Exists(logPath) && new FileInfo(logPath).Length > 512 * 1024)
                {
                    string archivedPath = logPath + ".old";
                    if (File.Exists(archivedPath)) File.Delete(archivedPath);
                    File.Move(logPath, archivedPath);
                }
                File.AppendAllText(logPath, line, Encoding.UTF8);
                return;
            }
            catch
            {
            }
        }
    }

    private static bool IsPortableLauncher(string path)
    {
        try
        {
            FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
            return String.Equals(info.ProductName, "Quick Pet Portable", StringComparison.OrdinalIgnoreCase)
                || String.Equals(info.FileDescription, "Portable launcher for Quick Pet", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static IEnumerable<string> PortableLaunchers(string directory)
    {
        return Directory.GetFiles(directory, "*.exe", SearchOption.TopDirectoryOnly)
            .Where(path => IsPortableLauncher(path));
    }

    private static bool TryLaunchNewerPortable(string[] arguments)
    {
        string currentPath = Path.GetFullPath(Application.ExecutablePath);
        string directory = Path.GetDirectoryName(currentPath);
        Version currentVersion = new Version(AppVersion);
        string newerLauncher = PortableLaunchers(directory)
            .Where(path => !String.Equals(Path.GetFullPath(path), currentPath, StringComparison.OrdinalIgnoreCase))
            .Select(path => new { Path = path, Version = ReadLauncherVersion(path) })
            .Where(candidate => candidate.Version != null && candidate.Version.CompareTo(currentVersion) > 0)
            .OrderByDescending(candidate => candidate.Version)
            .ThenByDescending(candidate => File.GetLastWriteTimeUtc(candidate.Path))
            .Select(candidate => candidate.Path)
            .FirstOrDefault();
        if (String.IsNullOrEmpty(newerLauncher))
        {
            return false;
        }

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = newerLauncher;
        startInfo.Arguments = String.Join(" ", (arguments ?? new string[0]).Select(QuoteArgument));
        startInfo.WorkingDirectory = Path.GetDirectoryName(newerLauncher);
        startInfo.UseShellExecute = false;
        if (Process.Start(startInfo) == null)
        {
            throw new InvalidOperationException("\u65e0\u6cd5\u542f\u52a8\u540c\u76ee\u5f55\u4e2d\u7684\u6700\u65b0\u4fbf\u643a\u7248\u3002");
        }
        return true;
    }

    private static Version ReadLauncherVersion(string path)
    {
        try
        {
            Version version;
            string value = FileVersionInfo.GetVersionInfo(path).FileVersion;
            return Version.TryParse(value, out version) ? version : null;
        }
        catch
        {
            return null;
        }
    }

    private static void DisableOlderPortableLaunchers()
    {
        string currentPath = Path.GetFullPath(Application.ExecutablePath);
        string directory = Path.GetDirectoryName(currentPath);
        Version currentVersion = new Version(AppVersion);
        var olderLaunchers = PortableLaunchers(directory)
            .Where(path => !String.Equals(Path.GetFullPath(path), currentPath, StringComparison.OrdinalIgnoreCase))
            .Select(path => new { Path = path, Version = ReadLauncherVersion(path) })
            .Where(candidate => candidate.Version != null && candidate.Version.CompareTo(currentVersion) < 0)
            .ToArray();
        foreach (var candidate in olderLaunchers)
        {
            try
            {
                string disabledPath = candidate.Path + ".disabled";
                if (File.Exists(disabledPath))
                {
                    disabledPath += "-" + DateTime.UtcNow.Ticks;
                }
                File.Move(candidate.Path, disabledPath);
            }
            catch (Exception error)
            {
                WriteDiagnostic("disable-old-launcher", error, candidate.Path);
            }
        }
    }

    private static Version ReadCacheVersion(string directory)
    {
        string name = Path.GetFileName(directory);
        int separator = name.IndexOf('-');
        string value = separator > 0 ? name.Substring(0, separator) : name;
        Version version;
        return Version.TryParse(value, out version) ? version : null;
    }

    private static void EnsureNoNewerCacheVersion()
    {
        string root = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "QuickPet-Portable-Cache");
        if (!Directory.Exists(root))
        {
            return;
        }
        Version currentVersion = new Version(AppVersion);
        bool newerCacheExists = Directory.GetDirectories(root)
            .Select(ReadCacheVersion)
            .Any(version => version != null && version.CompareTo(currentVersion) > 0);
        if (newerCacheExists)
        {
            throw new InvalidOperationException("\u68c0\u6d4b\u5230\u66f4\u9ad8\u7248\u672c\u7684\u8fd0\u884c\u6587\u4ef6\u3002\u65e7\u7248\u5df2\u505c\u6b62\u542f\u52a8\uff0c\u8bf7\u4f7f\u7528\u540c\u76ee\u5f55\u4e2d\u7684\u6700\u65b0\u4fbf\u643a EXE\u3002");
        }
    }

    private static string[] QuarantineStaleCaches(string currentCacheDirectory)
    {
        string root = Path.GetDirectoryName(currentCacheDirectory);
        Version currentVersion = new Version(AppVersion);
        List<string> quarantined = new List<string>();
        foreach (string directory in Directory.GetDirectories(root))
        {
            string candidate = Path.GetFullPath(directory);
            if (String.Equals(candidate, Path.GetFullPath(currentCacheDirectory), StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            Version candidateVersion = ReadCacheVersion(candidate);
            if (candidateVersion == null || candidateVersion.CompareTo(currentVersion) > 0)
            {
                continue;
            }

            if (candidate.IndexOf(".deleting-", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                quarantined.Add(candidate);
                continue;
            }
            string deletingDirectory = candidate + ".deleting-" + Process.GetCurrentProcess().Id;
            try
            {
                if (Directory.Exists(deletingDirectory))
                {
                    Directory.Delete(deletingDirectory, true);
                }
                Directory.Move(candidate, deletingDirectory);
                quarantined.Add(deletingDirectory);
            }
            catch (Exception error)
            {
                WriteDiagnostic("quarantine-stale-cache", error, candidate);
            }
        }
        return quarantined.ToArray();
    }

    private static void DeleteQuarantinedCaches(string[] staleCaches)
    {
        foreach (string deletingDirectory in staleCaches ?? new string[0])
        {
            try
            {
                Directory.Delete(deletingDirectory, true);
            }
            catch (Exception error)
            {
                WriteDiagnostic("delete-quarantined-cache", error, deletingDirectory);
            }
        }
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
    '/codepage:65001',
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
