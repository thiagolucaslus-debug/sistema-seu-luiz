@echo off
chcp 65001 >nul
title Configurar Nuvem 24/7 + Google Drive - Sistema Seu Luiz
cd /d "%~dp0"

set "PY_EXE=C:\Users\thiag\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

"%PY_EXE%" "%~dp0scripts\configurar_nuvem_drive.py"
pause
