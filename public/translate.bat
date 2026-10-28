@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Local\nvm\v24.22.1\node translate.js minifyall
%LOCALAPPDATA%\..\Local\nvm\v24.22.1\node translate.js translateall
%LOCALAPPDATA%\..\Local\nvm\v24.22.1\node translate.js extractall
DEL ..\emails\translations\*-min_*
Pause