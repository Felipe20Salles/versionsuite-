@echo off
cd /d "%~dp0"

if not exist ".env" (
  echo ERRO: arquivo .env nao encontrado.
  echo Copie redmine.env.example para .env e preencha as variaveis.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if not "%%a"=="" (
    set "%%a=%%b"
  )
)

node redmine-proxy.js
pause
