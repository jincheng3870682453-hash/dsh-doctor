@echo off
setlocal
set "PS1=%~dp0src\dsh-doctor.ps1"
if not exist "%PS1%" (
  echo [dsh-doctor] src\dsh-doctor.ps1 not found next to this launcher.
  exit /b 2
)
where pwsh >nul 2>nul
if not errorlevel 1 goto usepwsh
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
goto done
:usepwsh
pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
:done
endlocal & exit /b %ERRORLEVEL%
