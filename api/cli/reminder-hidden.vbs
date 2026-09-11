' Runs the notification sweep with no console window.
'
' Why this file exists: Windows Task Scheduler runs its action directly, not
' through a shell. A task that runs php.exe every minute while someone is
' logged on flashes a black console window on the shop counter's screen every
' minute, all day. wscript.exe can start the same command hidden.
'
' It also means the task's action carries no shell metacharacters, which is the
' other half of the problem: ">> log.txt" in a Task Scheduler argument is not
' redirection, it is two more arguments handed to php.exe. The sweep writes its
' own log instead (see reminder.php).
'
'   wscript.exe "...\api\cli\reminder-hidden.vbs" "C:\xampp\php\php.exe"
'
' The PHP path is an argument rather than a constant so this file has nothing
' machine-specific baked into it; install-reminder-task.ps1 fills it in.

Option Explicit

Dim fso, shell, quote, php, script, here

If WScript.Arguments.Count < 1 Then
  WScript.Echo "usage: wscript reminder-hidden.vbs <path to php.exe>"
  WScript.Quit 2
End If

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

quote  = Chr(34)
php    = WScript.Arguments(0)
here   = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(here, "reminder.php")

If Not fso.FileExists(php) Then
  WScript.Echo "php.exe not found: " & php
  WScript.Quit 2
End If
If Not fso.FileExists(script) Then
  WScript.Echo "reminder.php not found: " & script
  WScript.Quit 2
End If

' 0 = hidden window, True = wait, so the task's exit code is the sweep's own.
WScript.Quit shell.Run(quote & php & quote & " " & quote & script & quote, 0, True)
