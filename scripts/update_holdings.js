import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { fetchAllProblemHoldings } from './fetch_holdings.js';
import { fetchFundNavHistory, trainAllFunds } from './train_stock_regression.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const HOLDINGS_OUTPUT = path.join(DATA_DIR, 'fund_holdings.json');
const REGRESSION_OUTPUT = path.join(DATA_DIR, 'fund_holdings_regression.json');
const PROBLEM_FUNDS = [
  { code: '501303', name: '恒生中型股LOF', category: 'hk' }, { code: '161124', name: '港股小盘LOF', category: 'hk' },
  { code: '501021', name: '香港中小LOF', category: 'hk' }, { code: '501310', name: '价值基金LOF', category: 'hk' },
  { code: '501302', name: '恒生指数基金LOF', category: 'hk' }, { code: '501307', name: '银河高股息LOF', category: 'hk' },
  { code: '501306', name: '港股高股息LOFC', category: 'hk' }, { code: '160717', name: 'H股LOF', category: 'hk' },
  { code: '501311', name: '新经济港通LOF', category: 'hk' }, { code: '501301', name: '香港大盘LOF', category: 'hk' },
  { code: '164705', name: '恒生LOF', category: 'hk' }, { code: '161831', name: '恒生国企LOF', category: 'hk' },
  { code: '501305', name: '港股高股息LOF', category: 'hk' }, { code: '160924', name: '恒生指数LOF', category: 'hk' },
  { code: '501025', name: '香港银行LOF', category: 'hk' }, { code: '160322', name: '港股精选LOF', category: 'hk' },
  { code: '160644', name: '港美互联网LOF', category: 'hk' }, { code: '161126', name: '标普医疗保健LOF', category: 'us' },
  { code: '161725', name: '招商中证白酒LOF', category: 'cn' }, { code: '161032', name: '富国中证煤炭指数LOF', category: 'cn' },
  { code: '161217', name: '国投瑞银上游资源LOF', category: 'cm' }, { code: '161715', name: '招商中证大宗商品LOF', category: 'cm' },
];
async function main() {
  console.log('='.repeat(66)); console.log('  LOF基金 — 十大持仓与权重回归'); console.log(`  运行: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`); console.log('='.repeat(66));
  console.log('\nStep 1: 获取十大持仓'); console.log('-'.repeat(60));
  const holdingsMap = await fetchAllProblemHoldings(PROBLEM_FUNDS);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HOLDINGS_OUTPUT, JSON.stringify({ updatedAt: new Date().toISOString(), totalFunds: PROBLEM_FUNDS.length, fundsWithHoldings: Object.values(holdingsMap).filter(h => h?.holdings?.length > 0).length, results: holdingsMap }, null, 2), 'utf-8');
  console.log(`\n[LOG] 持仓数据已保存到 ${HOLDINGS_OUTPUT}`);
  console.log('\nStep 2: 获取有持仓基金的历史净值'); console.log('-'.repeat(60));
  const navDataMap = {}; const codesWithHoldings = Object.entries(holdingsMap).filter(([, v]) => v?.holdings?.length > 0).map(([k]) => k);
  for (let i = 0; i < codesWithHoldings.length; i++) { const code = codesWithHoldings[i]; process.stdout.write(`  [${i+1}/${codesWithHoldings.length}] ${code}...`); const navData = await fetchFundNavHistory(code, 120); if (navData.length > 0) { navDataMap[code] = navData; process.stdout.write(` ${navData.length}日\n`); } else { process.stdout.write(` ❌\n`); } }
  console.log('\nStep 3: 持仓权重回归训练'); console.log('-'.repeat(60));
  const regressionResults = await trainAllFunds(holdingsMap, navDataMap);
  fs.writeFileSync(REGRESSION_OUTPUT, JSON.stringify({ updatedAt: new Date().toISOString(), totalFunds: codesWithHoldings.length, results: regressionResults }, null, 2), 'utf-8');
  console.log(`\n[LOG] 回归结果已保存到 ${REGRESSION_OUTPUT}`);
  console.log('\n' + '='.repeat(66)); console.log('  十大持仓权重回归 — 汇总'); console.log('='.repeat(66));
  const doneResults = Object.entries(regressionResults).filter(([, v]) => v.status === 'done');
  doneResults.forEach(([code, r]) => { const tag = r.constrainedR2 > 0.8 ? '✅' : r.constrainedR2 > 0.6 ? '👍' : r.constrainedR2 > 0.4 ? '⚠️' : '❌'; const fund = PROBLEM_FUNDS.find(f => f.code === code); console.log(`  ${tag} ${code} ${fund?.name||''}: 回归R²=${(r.regressionR2*100).toFixed(1)}% → 约束R²=${(r.constrainedR2*100).toFixed(1)}% (${r.availableStocks}/${r.totalStocks}只股票, ${r.samples}样本)`); });
  const skipped = Object.values(regressionResults).filter(v => v.status === 'skipped').length; const failed = Object.values(regressionResults).filter(v => v.status === 'failed').length;
  console.log(`\n  总结: ✅回归完成${doneResults.length}  ⏭️跳过${skipped}  ❌失败${failed}`);
}
main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
