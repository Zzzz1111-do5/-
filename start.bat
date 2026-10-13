@echo off
rem CoinQuant one-click start for Windows: double-click this file.
rem Keep this file ASCII-only with CRLF line endings (cmd.exe requirement).
setlocal
cd /d "%~dp0"
if not exist "run.py" goto not_extracted

echo [CoinQuant] Checking Python... the first start can take a few minutes.
where py >nul 2>&1
if errorlevel 1 goto try_python
py -3 -c "import sys; sys.exit(sys.version_info < (3, 12))" >nul
if not errorlevel 1 goto use_py
:try_python
python -c "import sys; sys.exit(sys.version_info < (3, 12))" >nul 2>&1
if not errorlevel 1 goto use_python
goto no_python

:use_py
py -3 run.py %*
goto end

:use_python
python run.py %*
goto end

:not_extracted
echo.
echo  [CoinQuant] run.py was not found next to start.bat.
echo  It looks like start.bat was opened from inside the zip file.
echo  Close this window, right-click the zip file, choose "Extract All...",
echo  then open the extracted folder and double-click start.bat there.
echo.
goto end

:no_python
echo.
echo  [CoinQuant] Python 3.12 or newer was not found.
echo  Install it from https://www.python.org/downloads/ and then double-click start.bat again:
echo   - "Python install manager": just install it.
echo   - "Windows installer": tick "Add python.exe to PATH" during installation.
echo.

:end
pause
