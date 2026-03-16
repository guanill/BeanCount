@echo off
title Budget App

:: Check if already built
if not exist ".next\BUILD_ID" (
    echo Building Budget App for the first time...
    cd /d "d:\Proyectos\budget tracking\budget-app"
    call npm run build
)

cd /d "d:\Proyectos\budget tracking\budget-app"

:: Open browser once port 3000 is ready
start "" powershell -NoProfile -WindowStyle Hidden -Command "$ok=$false; for($i=0;$i -lt 30;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('localhost',3000);$c.Close();$ok=$true;break}catch{Start-Sleep -Milliseconds 500}}; if($ok){Start-Process 'http://localhost:3000'}"

:: Run production server (much faster startup than dev)
npm run start
