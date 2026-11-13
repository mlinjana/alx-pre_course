@echo off
rem Double-click this file to start JARVIS.
rem Everything it installs goes inside this folder (.venv), not system-wide.
setlocal
cd /d "%~dp0"
title JARVIS launcher

set "PY="
py -3 --version >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto have_python
python --version >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto have_python

echo.
echo  Python is not installed on this PC, and JARVIS needs it.
echo  Install Python 3.10 or newer from https://www.python.org/downloads/
echo  then double-click this file again.
echo.
pause
exit /b 1

:have_python
if exist ".venv\Scripts\pythonw.exe" goto have_venv
echo  First start: setting up JARVIS in this folder. This takes a minute or two...
%PY% -m venv .venv
if errorlevel 1 goto setup_failed
".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto setup_failed

:have_venv
if exist ".env" goto have_env
copy /y ".env.example" ".env" >nul
echo.
echo  One more step: JARVIS needs your Anthropic API key.
echo  Notepad will open a file named .env - paste your key after
echo  ANTHROPIC_API_KEY=  then save, close Notepad, and come back here.
echo.
notepad ".env"
pause

:have_env
start "" ".venv\Scripts\pythonw.exe" main.py
exit /b 0

:setup_failed
echo.
echo  Setup did not finish. Check your internet connection and try again.
echo  If it keeps failing, delete the .venv folder in this folder and retry.
echo.
if exist ".venv" rmdir /s /q ".venv"
pause
exit /b 1
