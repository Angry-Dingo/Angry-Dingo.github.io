$json = Get-Content 'c:\Users\25933\Documents\TRAE-Study\Angry-Dingo.github.io\data\fund_holdings_regression.json' -Raw | ConvertFrom-Json
Write-Host "=== 十大持仓回归 (updatedAt: $($json.updatedAt)) ==="
Write-Host "总基金: $($json.totalFunds)"
Write-Host ""

$results = @()
foreach ($prop in $json.results.PSObject.Properties) {
    $code = $prop.Name
    $r = $prop.Value
    $ridgeR2 = [math]::Round($r.ridgeR2 * 100, 1)
    $nnlsR2 = [math]::Round($r.nnlsR2 * 100, 1)
    $results += [PSCustomObject]@{Code=$code; RidgeR2=$ridgeR2; NNLSR2=$nnlsR2; Stocks="$($r.availableStocks)/$($r.totalStocks)"; Samples=$r.samples}
}
$results | Sort-Object NNLSR2 -Descending | Format-Table -AutoSize

Write-Host "`n--- 统计 ---"
$pos = ($results | Where-Object { $_.NNLSR2 -gt 0 }).Count
Write-Host "NNLS-R² > 0: $pos / $($results.Count)"
$pos10 = ($results | Where-Object { $_.NNLSR2 -gt 10 }).Count
Write-Host "NNLS-R² > 10%: $pos10 / $($results.Count)"
$best = $results | Sort-Object NNLSR2 -Descending | Select-Object -First 1
Write-Host "最佳: $($best.Code) RidgeR²=$($best.RidgeR2)% NNLS-R²=$($best.NNLSR2)%"
$worst = $results | Sort-Object NNLSR2 | Select-Object -First 1
Write-Host "最差: $($worst.Code) RidgeR²=$($worst.RidgeR2)% NNLS-R²=$($worst.NNLSR2)%"