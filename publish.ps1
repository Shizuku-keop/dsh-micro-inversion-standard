# One-click publish: create GitHub repo -> push -> tag -> GitHub Release with zip asset.
#
# Usage (run in THIS repo directory, on any machine with outbound HTTPS):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -Token <PAT>
#
# Required token:
#   - classic PAT with `repo` scope, or
#   - fine-grained PAT with Administration:write (create repo) + Contents:write (push)
#     and a one-time push via HTTPS uses your username as the login.
#
# Switches:
#   -Token <string>     GitHub PAT (never commit it; it is used only in this process)
#   -RepoName <string>  default: dsh-micro-inversion-standard
#   -Visibility <string> default: public  (public|private)
#   -Tag <string>       default: v1.0.0
#   -SkipCreate         repo already exists: skip repo creation, only push + tag + release
#   -SkipRelease        do not create a GitHub Release (tag only)
#
# After publishing, the script rewrites the local `origin` to the clean HTTPS URL
# (no token embedded) and prints the repo URL.

param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$RepoName = 'dsh-micro-inversion-standard',
  [ValidateSet('public', 'private')][string]$Visibility = 'public',
  [string]$Tag = 'v2.3.0',
  [string]$Description = '微逆标准模式 (Micro-Inversion Standard) — a token-lean DSH agent preset that forces "we need" reasoning (bilingual EN/ZH) and slims context.',
  [switch]$SkipCreate,
  [switch]$SkipRelease
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$headers = @{
  Authorization = "token $Token"
  'User-Agent'  = 'dsh-micro-inversion-standard-publisher'
  Accept        = 'application/vnd.github+json'
}
$api = 'https://api.github.com'

Write-Host "== 1/5 authenticate =="
$me = Invoke-RestMethod -Uri "$api/user" -Headers $headers
$owner = $me.login
Write-Host "authenticated as: $owner"

Write-Host "== 2/5 ensure repo '$RepoName' ($Visibility) =="
$repoUrl = "$api/repos/$owner/$RepoName"
try {
  Invoke-RestMethod -Uri $repoUrl -Headers $headers -Method Get | Out-Null
  Write-Host "repo already exists"
} catch {
  if ($SkipCreate) { throw "repo '$RepoName' does not exist and -SkipCreate was given" }
  $body = @{
    name        = $RepoName
    description = $Description
    private     = ($Visibility -eq 'private')
    has_issues  = $true
    has_wiki    = $false
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "$api/user/repos" -Headers $headers -Method Post -ContentType 'application/json' -Body $body | Out-Null
  Write-Host "repo created: https://github.com/$owner/$RepoName"
}

Write-Host "== 3/5 push =="
$authOrigin = "https://x-access-token:$Token@github.com/$owner/$RepoName.git"
git remote remove origin 2>$null
git remote add origin $authOrigin
git branch -M main
git push -u origin main
git tag -f $Tag
# NOTE: --force overwrites a remote tag of the same name (intended for republish).
git push --force origin $Tag

Write-Host "== 4/5 clean origin (drop token) =="
git remote set-url origin "https://github.com/$owner/$RepoName.git"

if (-not $SkipRelease) {
  Write-Host "== 5/5 create GitHub Release $Tag =="
  $releaseBody = @{
    tag_name = $Tag
    name     = $Tag
    body     = "See README.md for install & usage.`n`nRelease asset: dsh-micro-inversion-standard-$Tag.zip (extract and run install.ps1 / install.sh).`n`nCurrent preset version: 2.3.0 (v6 stable-compliance anchor throttling, integrity gate + session forensics tooling, 40 automated tests)."
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Uri "$api/repos/$owner/$RepoName/releases" -Headers $headers -Method Post -ContentType 'application/json' -Body $releaseBody

  $zip = Join-Path $PSScriptRoot "dist\dsh-micro-inversion-standard-$Tag.zip"
  if (Test-Path $zip) {
    $uploadUrl = $release.upload_url -replace '\{[^}]*\}', "?name=$(Split-Path $zip -Leaf)"
    curl.exe -s -H "Authorization: token $Token" -H "Content-Type: application/zip" --data-binary "@$zip" $uploadUrl | Out-Null
    Write-Host "zip uploaded: $zip"
  } else {
    Write-Host "zip not found, skipped asset upload: $zip"
  }
} else {
  Write-Host "== 5/5 skipped (release not created; tag $Tag pushed) =="
}

Write-Host ''
Write-Host "Done: https://github.com/$owner/$RepoName"
Write-Host "Local origin is clean (no token)."
