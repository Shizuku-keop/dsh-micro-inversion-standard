# Install the micro-inversion-standard agent preset into the DSH user preset root.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# Options:
#   -DshHome <path>   Override the DSH home directory (default: $env:USERPROFILE\.dsh)

param(
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh')
)

$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'preset'
$dst = Join-Path $DshHome '.agent-presets\micro-inversion-standard'

if (-not (Test-Path $src)) {
  Write-Error "preset folder not found next to this script: $src"
  exit 1
}

if (Test-Path $dst) {
  Write-Host "Overwriting existing preset at: $dst"
  Remove-Item -Recurse -Force $dst
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force

Write-Host ''
Write-Host "Installed: $dst"
Write-Host 'Next: restart the dsh web service, create a new session,'
Write-Host 'and pick "Micro-Inversion Standard" from the preset selector.'
