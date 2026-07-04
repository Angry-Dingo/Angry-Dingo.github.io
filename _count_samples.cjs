const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/fund_holdings_regression.json', 'utf8'));

console.log('=== 十大持仓回归样本量分布 (updatedAt: ' + data.updatedAt + ') ===');
console.log('');

const samplesCount = {};
for (const [code, r] of Object.entries(data.results)) {
    const n = r.samples;
    samplesCount[n] = (samplesCount[n] || 0) + 1;
}

const sorted = Object.entries(samplesCount).sort(([a], [b]) => a - b);
console.log('样本量 | 基金数量');
console.log('-------|-------');
for (const [n, count] of sorted) {
    console.log(n.padStart(6) + ' | ' + count.toString());
}

console.log('');
console.log('所有基金详情：');
console.log('');

const details = [];
for (const [code, r] of Object.entries(data.results)) {
    details.push({ code, samples: r.samples, ridgeR2: (r.regressionR2 * 100).toFixed(1), nnlsR2: (r.constrainedR2 * 100).toFixed(1) });
}
details.sort((a, b) => a.samples - b.samples);

console.log('代码   | 样本 | RidgeR² | NNLS-R²');
console.log('-------|------|---------|---------');
for (const d of details) {
    console.log(d.code + ' | ' + d.samples.toString().padStart(4) + ' | ' + d.ridgeR2.padStart(7) + ' | ' + d.nnlsR2);
}