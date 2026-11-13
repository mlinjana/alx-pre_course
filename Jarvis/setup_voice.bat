@echo off
rem Double-click to add voice to JARVIS. Everything goes inside this folder.
setlocal
cd /d "%~dp0"
title JARVIS voice setup
if exist ".venv\Scripts\python.exe" goto have_venv
echo  Please run start_jarvis.bat once first, then run this again.
pause
exit /b 1

:have_venv
echo.
echo  This adds voice to JARVIS. It downloads about 350 MB of speech models
echo  and some Python packages into this folder only. Nothing is installed
echo  system-wide. It can take several minutes.
echo.
choice /c YN /m "Go ahead"
if errorlevel 2 exit /b 0
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements-voice.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" setup_voice.py
if errorlevel 1 goto failed
echo.
pause
exit /b 0

:failed
echo.
echo  Voice setup did not finish. The text chat still works as before.
echo  Voice needs Python 3.11 or newer and an internet connection for this step.
echo.
pause
exit /b 1
