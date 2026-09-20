@echo off
REM =============================================================
REM Orpa — Build Portable Windows x86_64 Binary
REM =============================================================
REM Uses Vercel's `pkg` to compile the entire Orpa server
REM (Node + deps + frontend) into a single standalone .exe.
REM No Node.js installation needed on the target PC.
REM
REM Prerequisites (on the BUILD machine):
REM   - Node.js 18+ installed
REM   - npm
REM
REM Usage:
REM   build-windows.bat
REM
REM Output:
REM   dist\orpa-server.exe  (single ~50 MB binary)
REM =============================================================

echo.
echo ========================================
echo  Orpa Portable Builder (Windows x64)
echo ========================================
echo.

set "SCRIPT_DIR=%~dp0"
set "SOURCE_DIR=%SCRIPT_DIR%..\.."
set "BUILD_DIR=%SCRIPT_DIR%build-tmp"
set "OUTPUT_DIR=%SCRIPT_DIR%dist"

REM ---- 1. Prepare a clean build directory ----
if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%BUILD_DIR%"
mkdir "%OUTPUT_DIR%"
mkdir "%BUILD_DIR%\data"

REM Copy source files
xcopy /q /y "%SOURCE_DIR%\server.js" "%BUILD_DIR%\" >nul
xcopy /e /q /y /i "%SOURCE_DIR%\lib" "%BUILD_DIR%\lib" >nul
xcopy /e /q /y /i "%SOURCE_DIR%\public" "%BUILD_DIR%\public" >nul
copy /y "%SOURCE_DIR%\package.json" "%BUILD_DIR%\" >nul
if exist "%SOURCE_DIR%\package-lock.json" copy /y "%SOURCE_DIR%\package-lock.json" "%BUILD_DIR%\" >nul
copy /y "%SOURCE_DIR%\.env.example" "%BUILD_DIR%\" >nul

REM ---- 2. Install production dependencies ----
echo [1/4] Installing production dependencies...
cd /d "%BUILD_DIR%"
npm install --production --ignore-scripts >nul 2>&1
echo.

REM ---- 3. Install pkg compiler ----
echo [2/4] Installing pkg compiler...
npm install --no-save @vercel/pkg@5.8.1 >nul 2>&1
echo.

REM ---- 4. Compile into single .exe ----
echo [3/4] Compiling standalone .exe (this takes a minute)...
npx pkg server.js --target node18-win-x64 --output orpa-server.exe --config package.json --compress Brotli 2>nul
echo.

REM ---- 5. Package the distribution ----
echo [4/4] Packaging distribution...
move /y orpa-server.exe "%OUTPUT_DIR%\" >nul
copy /y "%SOURCE_DIR%\.env.example" "%OUTPUT_DIR%\" >nul
mkdir "%OUTPUT_DIR%\data"

REM Create a convenience launcher
echo @echo off> "%OUTPUT_DIR%\start.bat"
echo echo Starting Orpa Server...>> "%OUTPUT_DIR%\start.bat"
echo echo Open http://localhost:8000 in your browser>> "%OUTPUT_DIR%\start.bat"
echo echo Press Ctrl+C to stop>> "%OUTPUT_DIR%\start.bat"
echo echo.>> "%OUTPUT_DIR%\start.bat"
echo orpa-server.exe>> "%OUTPUT_DIR%\start.bat"

REM Create a README
echo =============================================== > "%OUTPUT_DIR%\README.txt"
echo   Orpa Server - Portable Edition (Windows) >> "%OUTPUT_DIR%\README.txt"
echo =============================================== >> "%OUTPUT_DIR%\README.txt"
echo. >> "%OUTPUT_DIR%\README.txt"
echo No installation needed. Just: >> "%OUTPUT_DIR%\README.txt"
echo. >> "%OUTPUT_DIR%\README.txt"
echo   1. Copy this entire folder to the target PC. >> "%OUTPUT_DIR%\README.txt"
echo   2. (Optional) Copy .env.example to .env and edit it. >> "%OUTPUT_DIR%\README.txt"
echo   3. Double-click start.bat >> "%OUTPUT_DIR%\README.txt"
echo      or run:  orpa-server.exe >> "%OUTPUT_DIR%\README.txt"
echo   4. Open http://localhost:8000 in a browser. >> "%OUTPUT_DIR%\README.txt"
echo. >> "%OUTPUT_DIR%\README.txt"
echo Default owner account: >> "%OUTPUT_DIR%\README.txt"
echo   Email:    owner@orpa.local >> "%OUTPUT_DIR%\README.txt"
echo   Password: changeme123 >> "%OUTPUT_DIR%\README.txt"
echo. >> "%OUTPUT_DIR%\README.txt"
echo !! Change these before first use !! >> "%OUTPUT_DIR%\README.txt"

REM Clean up
cd /d "%SCRIPT_DIR%"
rmdir /s /q "%BUILD_DIR%"

echo.
echo Build complete!
echo    Output: %OUTPUT_DIR%\
echo.
echo To run:  cd %OUTPUT_DIR% ^& start.bat
echo.
