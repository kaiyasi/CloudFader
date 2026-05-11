@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0tools\node.exe" (
  "%~dp0tools\node.exe" "%~dp0server.js"
) else (
  node "%~dp0server.js"
)
