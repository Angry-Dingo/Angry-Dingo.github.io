import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const FUNDS_JSON = path.join(DATA_DIR, 'funds.json');
const OUTPUT_JSON = path.join(DATA_DIR, 'fund_regression.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function httpGet(url, retries = 3, opts = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...opts.headers },
        ...opts,
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 10) return text;
      }
    } catch (e) {
      if (i < retries - 1) console.log(`  [RETRY] ${e.message}`);
    }
    if (i < retries - 1) await sleep(2000);
  }
  return null;
}
async function fetchFundNavHistory(code, days = 180) {
  const PAGE_SIZE = 20;
  const pages = Math.ceil(days / PAGE_SIZE);
  let allData = [];
  for (let p = 1; p <= pages; p++) {
    const text = await httpGet(`https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=${p}&pageSize=${PAGE_SIZE}&startDate=&endDate=`, 3, { headers: { Referer: 'https://fund.eastmoney.com/' } });
    if (!text) break;
    const m = text.match(/jQuery[^(]*\(([\s\S]+)\)/);
    if (!m) break;
    try {
      const data = JSON.parse(m[1]);
      if (!data.Data?.LSJZList) break;
      const items = data.Data.LSJZList.map(i => ({ date: i.FSRQ, nav: parseFloat(i.DWJZ) })).filter(d => d.nav > 0);
      allData = allData.concat(items);
      if (items.length < PAGE_SIZE) break;
    } catch (e) { break; }
  }
  return allData.reverse();
}
async function fetchTencentKline(symbol, days = 180) {
  const text = await httpGet(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${days},qfq`);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    if (data.code !== 0) return [];
    const root = data?.data?.[symbol];
    if (!root) return [];
    const kline = root.day || root.qfqday || [];
    return kline.map(k => {
      if (Array.isArray(k)) return { date: k[0], close: parseFloat(k[1]) };
      const p = k.split(','); return { date: p[0], close: parseFloat(p[1]) };
    }).filter(d => d.close > 0);
  } catch (e) { return []; }
}
async function fetchYahooHistory(symbol, days = 200) {
  const range = Math.ceil(days / 365 * 14);
  const text = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}mo`);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const result = data.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const d = new Date(timestamps[i] * 1000);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (quotes[i] > 0) rows.push({ date: dateStr, close: quotes[i] });
    }
    return rows;
  } catch (e) { return []; }
}
function solveOLS(y, X) {
  const n = y.length;
  if (n < 5) return null;
  const k = X[0].length;
  const Xw = X.map(r => [1, ...r]);
  const XtX = Array.from({ length: k + 1 }, () => Array(k + 1).fill(0));
  const Xty = Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) { for (let j = 0; j <= k; j++) { for (let l = 0; l <= k; l++) XtX[j][l] += Xw[i][j] * Xw[i][l]; Xty[j] += Xw[i][j] * y[i]; } }
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col <= k; col++) {
    let mr = col;
    for (let r = col + 1; r <= k; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[mr][col])) mr = r;
    [aug[col], aug[mr]] = [aug[mr], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= k + 1; j++) aug[col][j] /= pivot;
    for (let r = 0; r <= k; r++) { if (r !== col) { const f = aug[r][col]; for (let j = col; j <= k + 1; j++) aug[r][j] -= f * aug[col][j]; } }
  }
  const betas = aug.map(r => r[k + 1]);
  const ym = y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) { let yh = 0; for (let j = 0; j <= k; j++) yh += betas[j] * Xw[i][j]; ssr += (y[i] - yh) ** 2; sst += (y[i] - ym) ** 2; }
  return { betas, r2: sst > 1e-12 ? 1 - ssr / sst : 0, n };
}
function alignAndCompute(fundData, indexMap, lagDays = 0) {
  const idxKeys = Object.keys(indexMap);
  if (!idxKeys.length) return [];
  const dm = {};
  fundData.forEach(d => { dm[d.date] = { date: d.date, fundNav: d.nav }; });
  idxKeys.forEach(k => { (indexMap[k] || []).forEach(d => { if (!dm[d.date]) dm[d.date] = { date: d.date, fundNav: null }; dm[d.date][k] = d.close; }); });
  let al = Object.values(dm).sort((a, b) => a.date.localeCompare(b.date)).filter(d => d.fundNav && idxKeys.every(k => d[k] > 0));
  if (al.length < 3) return [];
  const ret = [];
  for (let i = 1 + lagDays; i < al.length; i++) {
    const fr = (al[i].fundNav - al[i - 1].fundNav) / al[i - 1].fundNav;
    if (!isFinite(fr)) continue;
    const ir = {};
    let valid = true;
    const ixCurr = al[i - lagDays];
    const ixPrev = al[i - 1 - lagDays];
    if (!ixCurr || !ixPrev) continue;
    for (const k of idxKeys) {
      if (ixPrev[k] > 0 && ixCurr[k] > 0) {
        ir[k] = (ixCurr[k] - ixPrev[k]) / ixPrev[k];
        if (!isFinite(ir[k])) valid = false;
      } else valid = false;
    }
    if (valid) ret.push({ date: al[i].date, fundRet: fr, idxRet: ir });
  }
  return ret;
}
function getCandidateIndices(fund) {
  const c = [];
  if (Array.isArray(fund.benchmark)) fund.benchmark.forEach(b => c.push(b.tq));
  else if (fund.benchmark?.tq) c.push(fund.benchmark.tq);
  else if (fund.benchmark) c.push(fund.benchmark);
  if (fund.category === 'us') c.push('usQQQ', 'usSPY', 'usKWEB', 'usGLD');
  if (fund.category === 'hk') c.push('hkHSI', 'hkHSCEI', 'hkHSTECH', 'usFXI', 'usMCHI', 'usEWH');
  if (fund.category === 'cn') c.push('sh000300', 'sh000905', 'sh000016', 'sh000688');
  if (fund.category === 'cm') c.push('usGLD', 'usSLV', 'usUSO', 'sh518880', 'sh000300');
  return [...new Set(c)];
}

// 东方财富 K线数据（CSI指数专用）
async function fetchEastMoneyKline(secid, days = 200) {
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=${days}&_=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data?.data?.klines?.length) return [];
    return data.data.klines.map(line => {
      const p = line.split(',');
      return { date: p[0], close: parseFloat(p[2]) };
    }).filter(d => d.close > 0);
  } catch (e) {
    return [];
  }
}

async function fetchIndexHistory(tq, days = 200) {
  if (tq.startsWith('us')) {
    const yh = { 'usQQQ':'QQQ','usSPY':'SPY','usKWEB':'KWEB','usGLD':'GLD','usSLV':'SLV','usUSO':'USO','usBNO':'BNO','usXBI':'XBI','usXLY':'XLY','usRSPH':'^RSPH','usXLK':'XLK','usINX':'^GSPC','usAGG':'AGG','usRWR':'RWR','usSMH':'SMH','usSGOL':'SGOL','usGLDM':'GLDM','usCPER':'CPER','usXOP':'XOP','usXLE':'XLE','usIXC':'IXC','usIAU':'IAU','usAAAU':'AAAU','usBCI':'BCI','usCOMT':'COMT','usINDA':'INDA','usFXI':'FXI','usMCHI':'MCHI','usEWH':'EWH' };
    const sym = yh[tq];
    return sym ? await fetchYahooHistory(sym, days) : [];
  }
  if (tq.startsWith('hk')) {
    const tm = { 'hkHSI':'hkHSI','hkHSCEI':'hkHSCEI','hkHSTECH':'hkHSTECH','hkHSMI':'hkHSMI','hkHSSI':'hkHSSI','hkHSCI':'hkHSCI' };
    return await fetchTencentKline(tm[tq] || tq, days);
  }
  if (tq.startsWith('sh') || tq.startsWith('sz') || tq.startsWith('nf')) {
    if (tq === 'nf_AG0') return [];
    return await fetchTencentKline(tq, days);
  }
  // CSI 指数走东方财富K线（腾讯不支持）
  if (tq.startsWith('csi')) {
    const em = { 'csi930917':'2.930917','csi930914':'2.930914','csi930792':'2.930792','csi930839':'2.930839','csi931573':'2.931573' };
    const secid = em[tq];
    return secid ? await fetchEastMoneyKline(secid, days) : [];
  }
  return [];
}
async function analyzeFunds(fundsData) {
  const fundList = fundsData.funds;
  const indexNames = fundsData.indexNames || {};
  console.log(`[LOG] 分析 ${fundList.length} 只基金\n`);
  console.log('='.repeat(60));
  console.log('Step 1: 获取基金历史净值');
  console.log('='.repeat(60));
  const allNavData = {};
  for (let i = 0; i < fundList.length; i++) {
    const f = fundList[i];
    process.stdout.write(`  [${i+1}/${fundList.length}] ${f.code} ${f.name}...`);
    const navData = await fetchFundNavHistory(f.code);
    if (navData.length > 0) { allNavData[f.code] = navData; process.stdout.write(` ${navData.length}日\n`); }
    else { process.stdout.write(` ❌ 失败\n`); }
    if (i % 5 === 4) await sleep(2000);
  }
  console.log('\n' + '='.repeat(60));
  console.log('Step 2: 构建指数池并获取历史数据');
  console.log('='.repeat(60));
  const allIndexTqs = new Set();
  for (const f of fundList) getCandidateIndices(f).forEach(c => allIndexTqs.add(c));
  ['sh000300','sh000905','sh000016','sh000688','hkHSI','hkHSCEI','hkHSTECH','usQQQ','usSPY','usGLD','usSLV','usUSO','usKWEB','usFXI','usMCHI','usEWH'].forEach(c => allIndexTqs.add(c));
  console.log(`[LOG] 共 ${allIndexTqs.size} 个候选指数`);
  const indexDataMap = {};
  let idxCount = 0;
  for (const tq of allIndexTqs) {
    process.stdout.write(`  [${++idxCount}/${allIndexTqs.size}] ${tq}...`);
    const data = await fetchIndexHistory(tq);
    if (data.length > 10) { indexDataMap[tq] = data; process.stdout.write(` ${data.length}日 ✅\n`); }
    else { process.stdout.write(` 不可用\n`); }
    if (idxCount % 8 === 0) await sleep(1000);
  }
  console.log('\n' + '='.repeat(60));
  console.log('Step 3: 回归分析');
  console.log('='.repeat(60));
  const results = [];
  for (let i = 0; i < fundList.length; i++) {
    const f = fundList[i];
    const navData = allNavData[f.code];
    if (!navData || navData.length < 10) {
      console.log(`  [${i+1}/${fundList.length}] ${f.code} ${f.name} ⏭️ 净值不足`);
      results.push({ code: f.code, name: f.name, category: f.category, status: 'skipped', reason: '净值不足' });
      continue;
    }
    const avIdx = getCandidateIndices(f).filter(tq => indexDataMap[tq] && indexDataMap[tq].length > 20);
    if (!avIdx.length) {
      console.log(`  [${i+1}/${fundList.length}] ${f.code} ${f.name} ⏭️ 无可用指数`);
      results.push({ code: f.code, name: f.name, category: f.category, status: 'skipped', reason: '无可用指数' });
      continue;
    }
    const sub = {}; avIdx.forEach(tq => { sub[tq] = indexDataMap[tq]; });
    const lags = f.category === 'us' ? [1, 0] : [0];
    let best = null;
    for (const lag of lags) {
      const ret = alignAndCompute(navData, sub, lag);
      if (ret.length < 5) continue;
      const y = ret.map(r => r.fundRet);
      const keys = Object.keys(sub);
      const sr = [];
      for (const k of keys) { const r2 = solveOLS(y, ret.map(r => [r.idxRet[k]])); if (r2) sr.push({ key: k, r2: r2.r2, beta: r2.betas[1] }); }
      if (!sr.length) continue;
      sr.sort((a, b) => b.r2 - a.r2);
      const cur = { lag, n: ret.length, bestSingleR2: sr[0].r2, bestIndex: sr[0].key, bestBeta: sr[0].beta, multiR2: 0 };
      if (sr.length >= 2) {
        const mk = [sr[0].key, sr[1].key];
        const r2 = solveOLS(y, ret.map(r => mk.map(k => r.idxRet[k])));
        if (r2) cur.multiR2 = r2.r2;
      }
      if (!best || cur.bestSingleR2 > best.bestSingleR2) best = cur;
    }
    if (!best || best.n < 5) {
      console.log(`  [${i+1}/${fundList.length}] ${f.code} ${f.name} ❌ 回归失败`);
      results.push({ code: f.code, name: f.name, category: f.category, status: 'failed' });
      continue;
    }
    const tag = best.bestSingleR2 > 0.8 ? '✅' : best.bestSingleR2 > 0.6 ? '👍' : best.bestSingleR2 > 0.4 ? '⚠️' : best.bestSingleR2 > 0.2 ? '🔶' : '❌';
    console.log(`  [${i+1}/${fundList.length}] ${f.code} ${f.name} ${tag} R²=${(best.bestSingleR2*100).toFixed(1)}% 滞后${best.lag}天 β=${best.bestBeta.toFixed(4)} 指数=${indexNames[best.bestIndex]||best.bestIndex}`);
    results.push({ code: f.code, name: f.name, category: f.category, status: 'done', lag: best.lag, samples: best.n, bestSingleR2: best.bestSingleR2, bestIndex: best.bestIndex, bestIndexName: indexNames[best.bestIndex] || best.bestIndex, bestBeta: best.bestBeta, multiR2: best.multiR2 });
    await sleep(500);
  }
  return results;
}
async function main() {
  console.log('='.repeat(60));
  console.log('  LOF基金 — 多因子回归验证分析 (修复滞后算法)');
  console.log(`  运行: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('='.repeat(60));
  const fundsData = JSON.parse(fs.readFileSync(FUNDS_JSON, 'utf-8'));
  console.log(`[LOG] 加载 ${fundsData.funds.length} 只基金`);
  const results = await analyzeFunds(fundsData);
  const output = { updatedAt: new Date().toISOString(), fundCount: fundsData.funds.length, summary: { total: results.length, done: results.filter(r => r.status === 'done').length, skipped: results.filter(r => r.status === 'skipped').length, failed: results.filter(r => r.status === 'failed').length }, results };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n[LOG] 结果已保存到 ${OUTPUT_JSON}`);
  console.log('\n' + '='.repeat(60));
  console.log('  回归分析汇总');
  console.log('='.repeat(60));
  const sorted = results.filter(r => r.status === 'done').sort((a, b) => b.bestSingleR2 - a.bestSingleR2);
  sorted.filter(r => r.bestSingleR2 > 0.8).forEach(r => console.log(`  ✅ ${r.code} ${r.name}: R²=${(r.bestSingleR2*100).toFixed(1)}% 滞后${r.lag}天 β=${r.bestBeta.toFixed(4)} ${r.bestIndexName}`));
  sorted.filter(r => r.bestSingleR2 > 0.6 && r.bestSingleR2 <= 0.8).forEach(r => console.log(`  👍 ${r.code} ${r.name}: R²=${(r.bestSingleR2*100).toFixed(1)}% 滞后${r.lag}天 β=${r.bestBeta.toFixed(4)} ${r.bestIndexName}`));
  sorted.filter(r => r.bestSingleR2 > 0.4 && r.bestSingleR2 <= 0.6).forEach(r => console.log(`  ⚠️ ${r.code} ${r.name}: R²=${(r.bestSingleR2*100).toFixed(1)}% 滞后${r.lag}天 β=${r.bestBeta.toFixed(4)} ${r.bestIndexName}`));
  sorted.filter(r => r.bestSingleR2 > 0.2 && r.bestSingleR2 <= 0.4).forEach(r => console.log(`  🔶 ${r.code} ${r.name}: R²=${(r.bestSingleR2*100).toFixed(1)}% 滞后${r.lag}天 β=${r.bestBeta.toFixed(4)} ${r.bestIndexName}`));
  sorted.filter(r => r.bestSingleR2 <= 0.2).forEach(r => console.log(`  ❌ ${r.code} ${r.name}: R²=${(r.bestSingleR2*100).toFixed(2)}% 滞后${r.lag}天 β=${r.bestBeta.toFixed(4)} ${r.bestIndexName}`));
  console.log(`\n总结: 共${sorted.length}只完成 ✅优秀${sorted.filter(r => r.bestSingleR2 > 0.8).length}  👍良好${sorted.filter(r => r.bestSingleR2 > 0.6).length}  ⚠️偏低${sorted.filter(r => r.bestSingleR2 <= 0.6).length}`);
}
main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
