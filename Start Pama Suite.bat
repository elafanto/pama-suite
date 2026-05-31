@echo off
title Pama Business Suite
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-pama-suite.ps1"
exit /b 0
