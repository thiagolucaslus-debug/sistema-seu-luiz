@echo off
chcp 65001 >nul
title Setup - Sistema Financeiro Seu Luiz
color 0B
echo.
echo =======================================================
echo    SISTEMA FINANCEIRO SEU LUIZ - INSTALADOR
echo =======================================================
echo.

set PASTA=%~dp0
set PYTHON=C:\Users\thiag\AppData\Local\Programs\Python\Python312\python.exe

echo [1/3] Verificando dependencias Python...
"%PYTHON%" -m pip install fastapi "uvicorn[standard]" sqlalchemy pydantic reportlab python-multipart pillow openpyxl bcrypt "python-jose[cryptography]" python-dateutil aiofiles --quiet
if errorlevel 1 (
    echo [!] Aviso: Houve algum alerta na instalacao do Python.
) else (
    echo [OK] Dependencias Python instaladas com sucesso.
)
echo.

echo [2/3] Instalando dependencias da Interface (Frontend)...
cd /d "%PASTA%frontend"
call npm.cmd install --quiet
if errorlevel 1 (
    echo [!] Aviso no npm install do frontend.
) else (
    echo [OK] Frontend instalado com sucesso.
)
echo.

echo [3/3] Instalando dependencias do Servico WhatsApp...
cd /d "%PASTA%whatsapp-service"
call npm.cmd install --quiet
if errorlevel 1 (
    echo [!] Aviso no npm install do whatsapp-service.
) else (
    echo [OK] Servico WhatsApp instalado com sucesso.
)
echo.

cd /d "%PASTA%"
echo =======================================================
echo    INSTALACAO CONCLUIDA COM SUCESSO!
echo =======================================================
echo.
echo Para abrir o sistema:
echo Execute o arquivo: iniciar.bat
echo.
pause
