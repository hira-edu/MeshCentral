@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Local\nvm\v24.22.1\node translate.js minifyall
DEL ..\emails\translations\*-min_*