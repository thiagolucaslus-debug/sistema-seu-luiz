@echo off
chcp 65001 >nul
title Sistema Financeiro Seu Luiz
color 0A
echo.
echo =======================================================
echo    INICIANDO O SISTEMA FINANCEIRO SEU LUIZ...
echo =======================================================
echo.

set PASTA=%~dp0
set PYTHON=C:\Users\thiag\AppData\Local\Programs\Python\Python312\python.exe
set SEU_LUIZ_DESKTOP_MODE=1

echo [1/3] Liberando portas anteriores caso estejam ocupadas...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 "') do taskkill /F /PID %%a >nul 2>&1

echo [2/3] Iniciando Servidor Backend (Python / FastAPI)...
start "Backend - Seu Luiz" cmd /k "cd /d "%PASTA%backend" && "%PYTHON%" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

echo [3/3] Iniciando Servico WhatsApp (Node.js)...
start "WhatsApp - Seu Luiz" cmd /k "cd /d "%PASTA%whatsapp-service" && node sender.js"

echo [4/4] Iniciando Interface Web (React)...
start "Frontend - Seu Luiz" cmd /k "cd /d "%PASTA%frontend" && npm.cmd run dev"

echo.
echo Aguardando inicializacao dos servicos...
timeout /t 4 /nobreak >nul

echo Abrindo seu navegador em http://localhost:5173...
start http://localhost:5173

echo.
echo =======================================================
echo    SISTEMA SEU LUIZ ESTA ATIVO!
echo =======================================================
echo.
echo  Interface Web:  http://localhost:5173
echo  API Backend:    http://localhost:8000/docs
echo  WhatsApp Status: http://localhost:3001/status
echo.
echo  Para fechar o sistema por completo, execute: parar.bat
echo =======================================================
echo.
pause
