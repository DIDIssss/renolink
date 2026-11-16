@echo off
setlocal
title RenoLink - MySQL Local
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INICIAR_RENOLINK.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] Inicializacao MySQL interrompida. Verifique a mensagem acima.
    pause
    exit /b 1
)
endlocal
