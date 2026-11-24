@echo off
chcp 65001 >nul
title DONGENS 博图仿真教学版
cd /d "%~dp0"

echo ==========================================
echo   DONGENS - 博图仿真教学版
echo ==========================================
echo.

set PORT=8931

echo [1/2] 正在启动本地服务器 (端口 %PORT%) ...
start "" /b python -m http.server %PORT% --bind 127.0.0.1 2>nul
if errorlevel 1 (
    echo   未找到 Python，改用 Node.js ...
    start "" /b npx --yes http-server -p %PORT% -a 127.0.0.1 2>nul
)

timeout /t 2 /nobreak >nul

echo [2/2] 正在打开浏览器 ...
start "" "http://127.0.0.1:%PORT%/index.html"

echo.
echo 服务已启动：http://127.0.0.1:%PORT%/
echo.
echo 提示：
echo   - 关闭此窗口不会停止服务，如需停止请关闭对应的 python/node 进程
echo   - 也可以直接双击 index.html 使用（无需服务器）
echo.
timeout /t 5 /nobreak >nul
exit
