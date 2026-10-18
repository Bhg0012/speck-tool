' Speck launcher for Windows, used by the "Speck" shortcut (the one with the Speck icon).
' Same steps as "Start Speck (Windows).bat" (scripts\start.js updates first), but with no
' console window. When something needs you to watch or act (first install, model download,
' missing Node.js), it opens that .bat so the progress is visible.
Option Explicit
Dim sh, fso, dir, logFile, code, text, f
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
logFile = sh.ExpandEnvironmentStrings("%TEMP%") & "\speck-launch.log"

Sub OpenVisibleLauncher()
  sh.Run """" & dir & "\Start Speck (Windows).bat""", 1, False
End Sub

If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  OpenVisibleLauncher
  WScript.Quit 0
End If

code = sh.Run("cmd /c node scripts\start.js --quiet > """ & logFile & """ 2>&1", 0, True)
If code = 3 Then
  OpenVisibleLauncher
ElseIf code <> 0 Then
  text = ""
  If fso.FileExists(logFile) Then
    Set f = fso.OpenTextFile(logFile, 1)
    If Not f.AtEndOfStream Then text = f.ReadAll
    f.Close
  End If
  If Len(text) > 600 Then text = "..." & Right(text, 600)
  MsgBox "Speck couldn't start." & vbCrLf & vbCrLf & text, vbExclamation, "Speck"
End If
