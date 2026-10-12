@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [WCL Scout] 未找到 Node.js。请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)
echo [WCL Scout] 正在启动本地助手...
echo 浏览器地址：http://127.0.0.1:17385
node src\server.js
echo.
echo [WCL Scout] 服务已退出，请查看上方报错。
pause
