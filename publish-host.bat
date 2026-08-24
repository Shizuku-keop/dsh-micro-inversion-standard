@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo   dsh-micro-inversion-standard  ->  GitHub publish helper
echo ============================================================
echo.
echo   Step 1: make sure the repo exists on GitHub
echo     - Browser: open https://github.com/new
echo     - Repository name: dsh-micro-inversion-standard
echo     - Do NOT tick "Add a README / .gitignore / license"
echo     - After creation, copy the repo URL, e.g.
echo       https://github.com/YOUR-NAME/dsh-micro-inversion-standard.git
echo.
set /p REPO=   Paste the repo URL and press Enter: 
if "%REPO%"=="" goto :err
git remote remove origin 2>nul
git remote add origin %REPO%
git branch -M main
echo.
echo   Step 2: push main branch + tag v1.0.0
echo     (the first push opens a browser window to sign in to GitHub)
git push -u origin main
if errorlevel 1 goto :err
git push origin v1.0.0
if errorlevel 1 goto :err
echo.
echo ============================================================
echo   PUBLISHED OK. On github.com, open the repo page then:
echo     Releases  -^>  Create a new release  -^>  tag v1.0.0
echo     upload dist\dsh-micro-inversion-standard-v1.0.0.zip
echo ============================================================
pause
exit /b 0
:err
echo.
echo   FAILED - read the error above (network / sign-in / repo name taken).
pause
exit /b 1
