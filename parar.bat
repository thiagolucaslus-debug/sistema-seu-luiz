@echo off
chcp 65001 >nul
title Parar Sistema Financeiro Seu Luiz
color 0C
echo.
echo =======================================================
echo    ENCERRANDO TODOS OS SERVICOS DO SISTEMA...
echo =======================================================
echo.

echo Finalizando servicos nas portas 8000, 5173 e 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 "') do taskkill /F /PID %%a >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1

echo.
echo [OK] Todos os servicos foram encerrados com sucesso!
echo.
timeout /t 3
