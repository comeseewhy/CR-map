$output = "project_export.txt"

Set-Content $output "===== index.html ====="
Get-Content index.html | Add-Content $output

Add-Content $output "`n===== style.css ====="
Get-Content style.css | Add-Content $output

Add-Content $output "`n===== app.js ====="
Get-Content app.js | Add-Content $output

Add-Content $output "`n`nGenerated: $(Get-Date)"

Write-Host "Export complete: $output"