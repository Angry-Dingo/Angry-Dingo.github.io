$json = Get-Content "$env:TEMP\holdings.json" -Raw | ConvertFrom-Json
Write-Host "=== 十大持仓回归 (updatedAt: $($json.updatedAt)) ==="
Write-Host "总基金: $($json.totalFunds)"
Write-Host ""

$results = @()
foreach ($prop in $json.results.PSObject.Properties) {
    $code = $prop.Name
    $r = $prop.Value
    $ridgeR2 = [math]::Round($r.regressionR2 * 100, 1)
    $nnlsR2 = [math]::Round($r.constrainedR2 * 100, 1)
    $results += [PSCustomObject]@{Code=$code; RidgeR2=$ridgeR2; NNLSR2=$nnlsR2; Stocks="$($r.availableStocks)/$($r.totalStocks)"; Samples=$r.samples}
}
$results | Sort-Object NNLSR2 -Descending | Format-Table Code, RidgeR2, NNLSR2, Stocks, Samples -AutoSize

Write-Host "--- 统计 ---"
$pos = ($results | Where-Object { $_.NNLSR2 -gt 0 }).Count
Write-Host "NNLS-R² > 0: $pos / $($results.Count)"
$pos10 = ($results | Where-Object { $_.NNLSR2 -gt 10 }).Count
Write-Host "NNLS-R² > 10%: $pos10 / $($results.Count)"
$pos50 = ($results | Where-Object { $_.NNLSR2 -gt 50 }).Count
Write-Host "NNLS-R² > 50%: $pos50 / $($results.Count)"
$best = $results | Sort-Object NNLSR2 -Descending | Select-Object -First 1
Write-Host "最佳: $($best.Code) RidgeR²=$($best.RidgeR2)% NNLS-R²=$($best.NNLSR2)%"
$worst = $results | Sort-Object NNLSR2 | Select-Object -First 1
Write-Host "最差: $($worst.Code) RidgeR²=$($worst.RidgeR2)% NNLS-R²=$($worst.NNLSR2)%"

$minSamples = ($results | Select-Object -ExpandProperty Samples | Measure-Object -Minimum).Minimum
$maxSamples = ($results | Select-Object -ExpandProperty Samples | Measure-Object -Maximum).Maximum
$avgSamples = [math]::Round(($results | Select-Object -ExpandProperty Samples | Measure-Object -Average).Average, 0)
Write-Host "样本量: 最小=$minSamples 最大=$maxSamples 平均=$avgSamples"