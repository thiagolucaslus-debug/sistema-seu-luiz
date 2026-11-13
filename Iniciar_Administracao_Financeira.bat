@echo off
title Administracao Financeira
chcp 65001 >nul
cls
echo ======================================================================
echo           ADMINISTRAÇÃO FINANCEIRA — SISTEMA PESSOAL DESKTOP
echo ======================================================================
echo.
echo Iniciando o sistema... Seu navegador padrão abrirá automaticamente.
echo Para fechar o sistema, feche esta janela.
echo.
cd /d "%~dp0"
start "" "%~dp0dist\AdministracaoFinanceira.exe"
exit
