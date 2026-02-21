# Set MSVC + Windows SDK environment for Tauri/Rust build.
# Use x64 toolchain on ARM64 PCs so build scripts and app are x64 (runs under emulation).
$vs = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"
$msvc = "$vs\VC\Tools\MSVC\14.50.35717"
$sdk = "C:\Program Files (x86)\Windows Kits\10"
$sdkVer = "10.0.26100.0"
$arch = "x64"

# On ARM64 host: Hostarm64\x64 = x64 linker. On x64 host: Hostx64\x64.
$hostX64 = if (Test-Path "$msvc\bin\Hostarm64\x64") { "$msvc\bin\Hostarm64\x64" } else { "$msvc\bin\Hostx64\x64" }
$env:Path = "$hostX64;$sdk\bin\$sdkVer\ucrt\x64;$sdk\bin\$sdkVer\um\x64;" + $env:Path
$env:LIB = "$msvc\lib\x64;$sdk\Lib\$sdkVer\ucrt\x64;$sdk\Lib\$sdkVer\um\x64;" + $env:LIB
$env:INCLUDE = "$msvc\include;$sdk\Include\$sdkVer\ucrt;$sdk\Include\$sdkVer\shared;$sdk\Include\$sdkVer\um;" + $env:INCLUDE

Write-Host "MSVC environment set for $arch" -ForegroundColor Green
