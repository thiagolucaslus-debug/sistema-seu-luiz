@echo off
chcp 65001 >nul
if exist "D:\AdministracaoFinanceira\Administracao Financeira.exe" (
    start "" "D:\AdministracaoFinanceira\Administracao Financeira.exe"
    exit /b 0
)
if exist "%LOCALAPPDATA%\Programs\Administracao Financeira\Administracao Financeira.exe" (
    start "" "%LOCALAPPDATA%\Programs\Administracao Financeira\Administracao Financeira.exe"
    exit /b 0
)
if exist "%~dp0dist\Administracao_Financeira_Setup.exe" (
    start "" "%~dp0dist\Administracao_Financeira_Setup.exe"
    exit /b 0
)
exit /b 1
