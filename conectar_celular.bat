@echo off
chcp 65001 >nul
title Conectar Celular - Sistema Seu Luiz
color 0B
echo.
echo =======================================================
echo    CONECTAR CELULAR — SISTEMA FINANCEIRO SEU LUIZ
echo =======================================================
echo.
echo Este utilitario cria um link HTTPS seguro e gratuito
echo para voce ou sua equipe acessarem o sistema pelo celular
echo de qualquer lugar, mesmo pela rede 4G/5G.
echo.

node "%~dp0scripts\tunnel.js"

pause
