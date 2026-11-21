@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
echo GBA 局域网联机
echo 正在检查服务；页面将自动打开。
echo 如果新建了服务，请保持此窗口打开。
"%NODE%" scripts\launcher.mjs
if errorlevel 1 (
  echo.
  echo 启动失败，请查看上方提示。
  pause
)
