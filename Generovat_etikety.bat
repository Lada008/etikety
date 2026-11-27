@echo off
chcp 65001 >nul
title Vinařství Salajka - Generátor tiskových etiket
echo =========================================================
echo   Vinarstvi Salajka - Generator tiskovych PDF etiket
echo =========================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\generate_labels.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [CHYBA] Generovani selhalo. Zkontrolujte data\odrudy.csv.
    pause
    exit /b 1
)
echo.
echo Oteviram slozku s vygenerovanymi PDF...
explorer "%~dp0output"
pause
