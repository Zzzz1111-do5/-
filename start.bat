@echo off
rem CoinQuant one-click start for Windows: double-click this file.
setlocal
cd /d "%~dp0"

py -3 --version >nul 2>&1
if not errorlevel 1 goto use_py
python --version >nul 2>&1
if not errorlevel 1 goto use_python
goto no_python

:use_py
py -3 run.py %*
goto end

:use_python
python run.py %*
goto end

:no_python
echo.
echo  [CoinQuant] Python 3.11+ was not found.
echo  Please install it from https://www.python.org/downloads/
echo  During installation, tick "Add python.exe to PATH", then double-click start.bat again.
echo.

:end
pause
