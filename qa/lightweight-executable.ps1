# Bounded executable discovery: known install paths, desktop shortcuts and registration. No recursive AppData/profile search.
param([ValidateSet('chrome','helium')][string]$Browser,[string]$Explicit)
$ErrorActionPreference='Stop'
if($Explicit){if(-not(Test-Path -LiteralPath $Explicit -PathType Leaf)){throw 'Explicit benchmark executable missing'};[IO.Path]::GetFullPath($Explicit);exit}
$candidates=New-Object System.Collections.Generic.List[string]
if($Browser -eq 'chrome'){
 foreach($base in @($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA)){if($base){$candidates.Add((Join-Path $base 'Google\Chrome\Application\chrome.exe'))}}
}else{
 foreach($base in @($env:LOCALAPPDATA,$env:ProgramFiles,${env:ProgramFiles(x86)})){if($base){foreach($suffix in @('imput\Helium\Application\chrome.exe','Helium\Application\chrome.exe','Helium\Application\helium.exe')){$candidates.Add((Join-Path $base $suffix))}}}
 $wsh=New-Object -ComObject WScript.Shell
 foreach($desktop in @([Environment]::GetFolderPath('Desktop'),(Join-Path $env:PUBLIC 'Desktop'))){foreach($link in @(Get-ChildItem -LiteralPath $desktop -Filter '*Helium*.lnk' -File -ErrorAction SilentlyContinue)){$target=$wsh.CreateShortcut($link.FullName).TargetPath;if($target){$candidates.Add($target)}}}
 foreach($regRoot in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')){
  foreach($entry in @(Get-ItemProperty -Path ($regRoot+'\*') -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match '^Helium(?:\s|$)'})){
   if($entry.InstallLocation){foreach($suffix in @('chrome.exe','helium.exe','Application\chrome.exe','Application\helium.exe')){$candidates.Add((Join-Path $entry.InstallLocation $suffix))}}
  }
 }
 foreach($appPath in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\helium.exe','HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\helium.exe')){$entry=Get-ItemProperty -LiteralPath $appPath -ErrorAction SilentlyContinue;if($entry -and $entry.'(default)'){$candidates.Add($entry.'(default)')}}
}
foreach($candidate in $candidates){if(Test-Path -LiteralPath $candidate -PathType Leaf){(Get-Item -LiteralPath $candidate).FullName;exit}}
throw ('No installed '+$Browser+' executable found; set D_'+$Browser.ToUpper()+'_EXE explicitly')
