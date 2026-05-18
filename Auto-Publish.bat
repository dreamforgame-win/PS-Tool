@echo off
color 0B
title UI-Link Auto Publisher

:: Force clean git if clean argument is provided
if "%1"=="clean" (
    rmdir /S /Q .git
    echo [Status] Old Git repository has been completely removed.
)

echo =======================================================
echo          UI-Link Plugin - Auto Publisher Tool
echo =======================================================
echo.

:: 1. Check if Git is initialized
if exist ".git" goto check_changes

echo [Status] Git repository not found. Initializing...
git init
git remote add origin https://github.com/dreamforgame-win/PS-Tool.git
git branch -M main
echo [Success] Remote repository bounded to dreamforgame-win/PS-Tool!
echo.

:check_changes
:: 2. Check for changes
git status -s > temp_status.txt
for %%A in (temp_status.txt) do set size=%%~zA
if "%size%"=="0" (
    del temp_status.txt
    echo [Done] No code changes detected. Exiting...
    echo.
    pause
    exit /b
)

echo [Changes Detected]
type temp_status.txt
del temp_status.txt
echo.

:: 3. Read and increment version
if not exist "version.json" (
    echo { "version": "1.0.0", "updateLog": "init" } > version.json
)

echo $j = Get-Content 'version.json' -Raw -Encoding UTF8 ^| ConvertFrom-Json; $v = $j.version; if (-not $v) { $v = '1.0.0' }; $p = $v.Split('.'); $p[-1] = ([int]$p[-1]+1).ToString(); Write-Output $v; Write-Output ($p -join '.') > temp_ps.ps1

powershell -ExecutionPolicy Bypass -File temp_ps.ps1 > temp_ver.txt
del temp_ps.ps1

set curVer=1.0.0
set nextVer=1.0.1
< temp_ver.txt (
  set /p curVer=
  set /p nextVer=
)
del temp_ver.txt

echo Current Version: Ver.%curVer%
set /p newVer="Enter NEW Version (Press Enter to use %nextVer%): "
if "%newVer%"=="" set newVer=%nextVer%

set /p updateLog="Enter Update Log: "
if "%updateLog%"=="" set updateLog=Bug fixes and improvements

:: 4. Write back JSON and Commit
echo $j = Get-Content 'version.json' -Raw -Encoding UTF8 ^| ConvertFrom-Json; $j.version = '%newVer%'; $j.updateLog = '%updateLog%'; $jsonStr = $j ^| ConvertTo-Json -Depth 10; [System.IO.File]::WriteAllText('version.json', $jsonStr, (New-Object System.Text.UTF8Encoding $false)) > temp_write.ps1

powershell -ExecutionPolicy Bypass -File temp_write.ps1
del temp_write.ps1

echo.
echo [Running] 1. Updated version.json to Ver.%newVer%
echo [Running] 2. Committing code locally...
git add .
git commit -m "v%newVer%: %updateLog%"

echo [Running] 3. Pushing code to Github...
git push origin main -f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =======================================================
    echo   [SUCCESS] Ver.%newVer% published to Github!
    echo   Artists will receive update prompt automatically!
    echo =======================================================
) else (
    echo.
    echo [ERROR] Push failed! Check your network or pull first.
)

echo.
pause