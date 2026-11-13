@echo off
title Publicar no GitHub - Sistema Seu Luiz
color 0A
cls
echo =======================================================
echo    ENVIANDO CODIGO PARA: thiagolucaslus-debug/sistema-seu-luiz
echo =======================================================
echo.
echo Enviando arquivos para o seu GitHub...
"%~dp0bin\git\cmd\git.exe" push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo =======================================================
    echo   [SUCESSO] SISTEMA PUBLICADO NO GITHUB!
    echo =======================================================
    echo.
    echo Agora no Render, basta atualizar a pagina e clicar
    echo em "Connect" no repositorio sistema-seu-luiz!
    echo.
) else (
    echo.
    echo =======================================================
    echo   ATENCAO: O REPOSITORIO AINDA NAO FOI CRIADO NO GITHUB!
    echo =======================================================
    echo.
    echo 1. Abra o link: https://github.com/new
    echo 2. Digite o nome: sistema-seu-luiz
    echo 3. Clique no botao verde "Create repository"
    echo 4. Depois execute este arquivo novamente!
    echo.
)
pause
