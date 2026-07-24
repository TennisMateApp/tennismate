$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\functions")
$env:GOOGLE_CLOUD_PROJECT = "tennismate-d8acb"

& npx tsx ../scripts/backfillActivityMatchEvents.ts `
  --write `
  --confirm-project=tennismate-d8acb `
  --confirm-checksum=a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7 `
  --batch-size=20 `
  --output=../activity-backfill-production-write.json

$backfillExit = $LASTEXITCODE
Write-Host "BACKFILL EXIT CODE: $backfillExit"
if ($backfillExit -eq 0) {
  Write-Host "Backfill completed. You may close this tab." -ForegroundColor Green
} else {
  Write-Host "Backfill failed. Leave this tab open for inspection." -ForegroundColor Red
}
