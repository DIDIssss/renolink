@echo off
setlocal
title RenoLink - Resetar Banco
cd /d "%~dp0"

set "NODE_CMD=node"

rem ==================================================
rem 01. LOCALIZAR NODE.JS
rem ==================================================
where node >nul 2>&1
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_CMD=%ProgramFiles(x86)%\nodejs\node.exe"
    ) else (
        echo.
        echo [ERRO] Node.js nao foi localizado.
        echo.
        pause
        exit /b 1
    )
)

rem ==================================================
rem 02. RESETAR BANCO
rem ==================================================
echo.
echo Resetando banco de dados...
"%NODE_CMD%" reset-db.js

if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel resetar o banco.
) else (
    echo.
    echo Banco restaurado com sucesso.
)

echo.
pause
endlocal
