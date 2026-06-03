import fetch from 'node-fetch';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE_UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
const FUND_UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://fund.eastmoney.com/' } };
async function httpGet(url, retries = 3, opts) {
  for (let i = 0; i < retries; i++) {
    try { const res = await fetch(url, opts || BASE_UA); if (res.ok) { const text = await res.text(); if (text && text.length > 10) return text; } } catch (e) { if (i < retries - 1) console.log(`    [RETRY] ${e.message}`); }
    if (i < retries - 1) await sleep(2000);
  }
  return null;
}
export async function fetchFundNavHistory(code, days = 120) {
  const text = await httpGet(`https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=1&pageSize=${days}&startDate=&endDate=`, 3, FUND_UA);
  if (!text) return [];
  const m = text.match(/jQuery[^(]*\(([\s\S]+)\)/); if (!m) return [];
  try { const data = JSON.parse(m[1]); if (!data.Data?.LSJZList) return []; return data.Data.LSJZList.map(i => ({ date: i.FSRQ, nav: parseFloat(i.DWJZ) })).filter(d => d.nav > 0).reverse(); } catch (e) { return []; }
}
export async function fetchTencentKline(symbol, days = 120) {
  const text = await httpGet(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${days},qfq`);
  if (!text) return [];
  try { const data = JSON.parse(text); if (data.code !== 0) return []; const root = data?.data?.[symbol]; if (!root) return []; const kline = root.day || root.qfqday || []; return kline.map(k => { if (Array.isArray(k)) return { date: k[0], close: parseFloat(k[1]) }; const p = k.split(','); return { date: p[0], close: parseFloat(p[1]) }; }).filter(d => d.close > 0); } catch (e) { return []; }
}
export async function fetchYahooHistory(symbol, days = 150) {
  const range = Math.ceil(days / 365 * 12);
  const text = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}mo`);
  if (!text) return [];
  try { const data = JSON.parse(text); const result = data.chart?.result?.[0]; if (!result) return []; const timestamps = result.timestamp || []; const quotes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || []; const rows = []; for (let i = 0; i < timestamps.length; i++) { const d = new Date(timestamps[i] * 1000); const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; if (quotes[i] > 0) rows.push({ date: dateStr, close: quotes[i] }); } return rows; } catch (e) { return []; }
}
export async function fetchStockHistory(tq, days = 120) {
  if (tq.startsWith('us')) { const yahooMap = { 'usTSM':'TSM','usNVDA':'NVDA','usMU':'MU','usAVGO':'AVGO','usGOOGL':'GOOGL','usASML':'ASML','usSNDK':'SNDK','usWST':'WST','usMRK':'MRK','usPFE':'PFE','usMTD':'MTD','usCI':'CI','usCRL':'CRL','usHUM':'HUM','usBMY':'BMY','usELV':'ELV','usJNJ':'JNJ' }; const sym = yahooMap[tq] || tq.replace('us', ''); return await fetchYahooHistory(sym, days); }
  if (tq.startsWith('hk')) return await fetchTencentKline(tq, days);
  if (tq.startsWith('sh') || tq.startsWith('sz')) return await fetchTencentKline(tq, days);
  return [];
}
function solveOLS(y, X) {
  const n = y.length; if (n < 5) return null;
  const k = X[0].length; const Xw = X.map(r => [1, ...r]);
  const XtX = Array.from({ length: k + 1 }, () => Array(k + 1).fill(0));
  const Xty = Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) { for (let j = 0; j <= k; j++) { for (let l = 0; l <= k; l++) XtX[j][l] += Xw[i][j] * Xw[i][l]; Xty[j] += Xw[i][j] * y[i]; } }
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col <= k; col++) { let mr = col; for (let r = col + 1; r <= k; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[mr][col])) mr = r; [aug[col], aug[mr]] = [aug[mr], aug[col]]; const pivot = aug[col][col]; if (Math.abs(pivot) < 1e-12) continue; for (let j = col; j <= k + 1; j++) aug[col][j] /= pivot; for (let r = 0; r <= k; r++) { if (r !== col) { const f = aug[r][col]; for (let j = col; j <= k + 1; j++) aug[r][j] -= f * aug[col][j]; } } }
  const betas = aug.map(r => r[k + 1]); const ym = y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0, sst = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let j = 0; j <= k; j++) yh += betas[j] * Xw[i][j]; ssr += (y[i] - yh) ** 2; sst += (y[i] - ym) ** 2; }
  return { betas, r2: sst > 1e-12 ? 1 - ssr / sst : 0, n };
}
export async function trainStockWeights(fundCode, holdingsData, fundNavData) {
  if (!holdingsData?.holdings?.length || !fundNavData?.length) return null;
  const stocks = holdingsData.holdings.filter(h => h.tq);
  if (stocks.length < 2) return null;
  console.log(`\n  ── 获取 ${stocks.length} 只持仓股票历史数据 ──`);
  const stockDataMap = {};
  for (const s of stocks) {
    process.stdout.write(`    ${s.tq} ${s.name}...`);
    const data = await fetchStockHistory(s.tq);
    if (data && data.length > 10) { stockDataMap[s.tq] = data; process.stdout.write(` ${data.length}日 ✅\n`); }
    else { process.stdout.write(` 不可用 ❌\n`); }
    await sleep(300);
  }
  const availableStocks = stocks.filter(s => stockDataMap[s.tq] && stockDataMap[s.tq].length > 10);
  if (availableStocks.length < 2) return null;
  const idxKeys = availableStocks.map(s => s.tq);
  const dm = {};
  fundNavData.forEach(d => { dm[d.date] = { date: d.date, fundNav: d.nav }; });
  idxKeys.forEach(k => { (stockDataMap[k] || []).forEach(d => { if (!dm[d.date]) dm[d.date] = { date: d.date, fundNav: null }; dm[d.date][k] = d.close; }); });
  let aligned = Object.values(dm).sort((a, b) => a.date.localeCompare(b.date)).filter(d => d.fundNav && idxKeys.every(k => d[k] > 0));
  if (aligned.length < 5) return null;
  const returns = [];
  for (let i = 1; i < aligned.length; i++) {
    const fr = (aligned[i].fundNav - aligned[i - 1].fundNav) / aligned[i - 1].fundNav; if (!isFinite(fr)) continue;
    const ir = {}; let valid = true;
    for (const k of idxKeys) { if (aligned[i - 1][k] > 0 && aligned[i][k] > 0) { ir[k] = (aligned[i][k] - aligned[i - 1][k]) / aligned[i - 1][k]; if (!isFinite(ir[k])) valid = false; } else valid = false; }
    if (valid) returns.push({ fundRet: fr, stockRet: ir });
  }
  if (returns.length < 5) return null;
  const n = returns.length;
  const totalPct = availableStocks.reduce((s, st) => s + (st.percent || 0), 0);
  const simpleWeights = availableStocks.map(st => ({ tq: st.tq, code: st.code, name: st.name, publishedPct: st.percent, simpleWeight: totalPct > 0 ? (st.percent || 0) / totalPct : 0 }));
  const y = returns.map(r => r.fundRet);
  const X = returns.map(r => availableStocks.map(s => r.stockRet[s.tq]));
  const olsResult = solveOLS(y, X);
  let regressionWeights = null, regR2 = 0;
  if (olsResult) {
    regR2 = olsResult.r2;
    const alpha = olsResult.betas[0];
    const betas = olsResult.betas.slice(1);
    const betaSum = betas.reduce((s, v) => s + v, 0);
    regressionWeights = availableStocks.map((st, i) => ({ tq: st.tq, code: st.code, name: st.name, publishedPct: st.percent, beta: betas[i], weight: betaSum > 0 ? betas[i] / betaSum : 0, alpha }));
  }
  let constrainedWeights = null, constrainedR2 = 0;
  if (regressionWeights) {
    const positiveBetas = regressionWeights.map(w => Math.max(0, w.beta));
    const betaSum = positiveBetas.reduce((s, v) => s + v, 0);
    constrainedWeights = regressionWeights.map((w, i) => ({ ...w, finalWeight: betaSum > 0 ? positiveBetas[i] / betaSum : 0 }));
    if (betaSum > 0) { let ssr = 0, sst2 = 0; const ym2 = y.reduce((s, v) => s + v, 0) / n; for (const r of returns) { let yh = 0; for (let j = 0; j < availableStocks.length; j++) yh += (positiveBetas[j] / betaSum) * r.stockRet[availableStocks[j].tq]; const idx = returns.indexOf(r); ssr += (y[idx] - yh) ** 2; sst2 += (y[idx] - ym2) ** 2; } constrainedR2 = sst2 > 0 ? 1 - ssr / sst2 : 0; }
  }
  return { samples: n, reportDate: holdingsData.reportDate, availableStocks: availableStocks.length, totalStocks: stocks.length, simpleWeights, regressionR2: regR2, constrainedR2, constrainedWeights };
}
export async function trainAllFunds(holdingsMap, navDataMap) {
  const results = {};
  const fundCodes = Object.keys(holdingsMap);
  for (let i = 0; i < fundCodes.length; i++) {
    const code = fundCodes[i], hData = holdingsMap[code];
    if (!hData?.holdings?.length) { results[code] = { status: 'skipped', note: hData?.note || 'no_holdings' }; continue; }
    const navData = navDataMap[code];
    if (!navData?.length) { results[code] = { status: 'skipped', note: 'no_nav_data' }; continue; }
    process.stdout.write(`\n[${i + 1}/${fundCodes.length}] ${code}`);
    const result = await trainStockWeights(code, hData, navData);
    if (result) { results[code] = { status: 'done', ...result }; const tag = result.constrainedR2 > 0.8 ? '✅' : result.constrainedR2 > 0.6 ? '👍' : result.constrainedR2 > 0.4 ? '⚠️' : '❌'; console.log(`  ${tag} R²=${(result.regressionR2*100).toFixed(1)}% 约束R²=${(result.constrainedR2*100).toFixed(1)}% 样本=${result.samples}日`); }
    else { results[code] = { status: 'failed' }; console.log(`  ❌`); }
  }
  return results;
}
