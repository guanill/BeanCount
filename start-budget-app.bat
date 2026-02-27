@echo off
title Budget App - Starting...
cd /d "d:\Proyectos\budget tracking\budget-app"
echo Starting Budget App...

:: Poll in background until port 3000 responds, then open browser
start "" powershell -NoProfile -WindowStyle Hidden -Command "$ok=$false; for($i=0;$i -lt 60;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('localhost',3000);$c.Close();$ok=$true;break}catch{Start-Sleep -Seconds 1}}; if($ok){Start-Process 'http://localhost:3000'}"

title Budget App
npm run dev
