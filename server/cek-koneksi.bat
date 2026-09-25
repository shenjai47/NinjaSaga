@echo off
cd /d "%~dp0"
echo Menjalankan pemeriksa koneksi Ninja Saga...
echo (server "node index.js" harus sedang jalan di jendela lain)
echo.
node cek-koneksi.js
echo.
pause
