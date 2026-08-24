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

# v5: transactional install — copy into a staging dir first, then swap, so
# an interrupted copy never leaves a half-installed preset behind.
$tmp = Join-Path $DshHome '.agent-presetsmicro-inversion-standard.tmp'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $tmp -Recurse -Force
if (Test-Path $dst) {
  Write-Host "Overwriting existing preset at: $dst"
  Remove-Item -Recurse -Force $dst
}
Move-Item -Path $tmp -Destination $dst

Write-Host ''
Write-Host "Installed: $dst"
Write-Host 'Next: restart the dsh web service, create a new session,'
Write-Host 'and pick "Micro-Inversion Standard" from the preset selector.'
