import fetch from 'node-fetch';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function httpGet(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 10) return text;
      }
    } catch (e) {
      if (i < retries - 1) console.log(`    [RETRY] ${e.message}`);
    }
    if (i < retries - 1) await sleep(2000);
  }
  return null;
}

export async function fetchFundNavHistory(code, days = 120) {
  const text = await httpGet(`https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=1&pageSize=${days}&startDate=&endDate=`, 3);
  if (!text) return [];
  const m = text.match(/jQuery[^(]*\(([\s\S]+)\)/);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    if (!data.Data?.LSJZList) return [];
    return data.Data.LSJZList.map(i => ({ date: i.FSRQ, nav: parseFloat(i.DWJZ) })).filter(d => d.nav > 0).reverse();
  } catch (e) { return []; }
}

export async function fetchTencentKline(symbol, days = 120) {
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

export async function fetchYahooHistory(symbol, days = 150) {
  const range = Math.ceil(days / 365 * 12);
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
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (quotes[i] > 0) rows.push({ date: dateStr, close: quotes[i] });
    }
    return rows;
  } catch (e) { return []; }
}

export async function fetchStockHistory(tq, days = 120) {
  if (tq.startsWith('us')) {
    const yahooMap = {
      'usTSM': 'TSM', 'usNVDA': 'NVDA', 'usMU': 'MU', 'usAVGO': 'AVGO',
      'usGOOGL': 'GOOGL', 'usASML': 'ASML', 'usSNDK': 'SNDK',
      'usWST': 'WST', 'usMRK': 'MRK', 'usPFE': 'PFE', 'usMTD': 'MTD',
      'usCI': 'CI', 'usCRL': 'CRL', 'usHUM': 'HUM', 'usBMY': 'BMY',
      'usELV': 'ELV', 'usJNJ': 'JNJ',
    };
    const sym = yahooMap[tq] || tq.replace('us', '');
    return await fetchYahooHistory(sym, days);
  }
  if (tq.startsWith('hk')) {
    return await fetchTencentKline(tq, days);
  }
  if (tq.startsWith('sh') || tq.startsWith('sz')) {
    return await fetchTencentKline(tq, days);
  }
  return [];
}

// Ridge回归（L2正则化），解决p>>n场景的过拟合
// lambda: 正则化强度，默认0.5（针对18个样本+10~40只股票场景调优）
function solveRidge(y, X, lambda = 0.5) {
  const n = y.length;
  if (n < 5) return null;
  const k = X[0].length;
  const Xw = X.map(r => [1, ...r]);
  const XtX = Array.from({ length: k + 1 }, () => Array(k + 1).fill(0));
  const Xty = Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) { for (let j = 0; j <= k; j++) { for (let l = 0; l <= k; l++) XtX[j][l] += Xw[i][j] * Xw[i][l]; Xty[j] += Xw[i][j] * y[i]; } }
  // 对系数部分（除截距外）加L2惩罚
  for (let j = 1; j <= k; j++) XtX[j][j] += lambda;
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

// 非负最小二乘（NNLS）— 坐标下降法，直接约束权重≥0
// 内置L2正则化，不包含截距项（权重直接归一化到1）
function solveNNLS(y, X, lambda = 0.3, maxIter = 5000, tol = 1e-8) {
  const n = y.length, k = X[0].length;
  if (n < 3 || k < 1) return null;

  // 预计算 XtX 和 Xty（不含截距）
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      for (let l = 0; l < k; l++) XtX[j][l] += X[i][j] * X[i][l];
      Xty[j] += X[i][j] * y[i];
    }
  }
  // 加L2正则化
  for (let j = 0; j < k; j++) XtX[j][j] += lambda;

  const w = new Array(k).fill(1 / k); // 初始化为均匀权重
  for (let iter = 0; iter < maxIter; iter++) {
    let maxChange = 0;
    for (let j = 0; j < k; j++) {
      const old = w[j];
      // 计算偏残差：y_j = (Xty_j - Σ_{l≠j} XtX_jl * w_l) / XtX_jj
      let partial = Xty[j];
      for (let l = 0; l < k; l++) if (l !== j) partial -= XtX[j][l] * w[l];
      const update = partial / XtX[j][j];
      w[j] = Math.max(0, update);
      maxChange = Math.max(maxChange, Math.abs(w[j] - old));
    }
    if (maxChange < tol) break;
  }

  // 归一化权重之和为1
  const sum = w.reduce((s, v) => s + v, 0);
  if (sum > 0) for (let j = 0; j < k; j++) w[j] /= sum;

  // 计算R²
  let ssr = 0, sst = 0;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  for (let i = 0; i < n; i++) {
    let pred = 0;
    for (let j = 0; j < k; j++) pred += w[j] * X[i][j];
    ssr += (y[i] - pred) ** 2;
    sst += (y[i] - ym) ** 2;
  }
  const r2 = sst > 0 ? 1 - ssr / sst : 0;
  return { weights: w, r2 };
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
    if (data && data.length > 10) {
      stockDataMap[s.tq] = data;
      process.stdout.write(` ${data.length}日 ✅\n`);
    } else {
      process.stdout.write(` 不可用 ❌\n`);
    }
    await sleep(300);
  }

  const availableStocks = stocks.filter(s => stockDataMap[s.tq] && stockDataMap[s.tq].length > 10);
  if (availableStocks.length < 2) return null;

  // Align data and compute returns
  const idxKeys = availableStocks.map(s => s.tq);
  const dm = {};
  fundNavData.forEach(d => { dm[d.date] = { date: d.date, fundNav: d.nav }; });
  idxKeys.forEach(k => {
    (stockDataMap[k] || []).forEach(d => {
      if (!dm[d.date]) dm[d.date] = { date: d.date, fundNav: null };
      dm[d.date][k] = d.close;
    });
  });

  let aligned = Object.values(dm).sort((a, b) => a.date.localeCompare(b.date)).filter(d => d.fundNav && idxKeys.every(k => d[k] > 0));
  if (aligned.length < 5) return null;

  const returns = [];
  for (let i = 1; i < aligned.length; i++) {
    const fr = (aligned[i].fundNav - aligned[i - 1].fundNav) / aligned[i - 1].fundNav;
    if (!isFinite(fr)) continue;
    const ir = {};
    let valid = true;
    for (const k of idxKeys) {
      if (aligned[i - 1][k] > 0 && aligned[i][k] > 0) {
        ir[k] = (aligned[i][k] - aligned[i - 1][k]) / aligned[i - 1][k];
        if (!isFinite(ir[k])) valid = false;
      } else valid = false;
    }
    if (valid) returns.push({ fundRet: fr, stockRet: ir });
  }

  if (returns.length < 5) return null;
  const n = returns.length;

  // Method 1: Simple weight-based (use published percentages directly)
  const totalPct = availableStocks.reduce((s, st) => s + (st.percent || 0), 0);
  const simpleWeights = availableStocks.map(st => ({
    tq: st.tq, code: st.code, name: st.name,
    publishedPct: st.percent,
    simpleWeight: totalPct > 0 ? (st.percent || 0) / totalPct : 0,
  }));

  // Method 2: Ridge regression（L2正则化替代OLS，解决过拟合）
  const y = returns.map(r => r.fundRet);
  const X = returns.map(r => availableStocks.map(s => r.stockRet[s.tq]));
  const ridgeResult = solveRidge(y, X);

  let regressionWeights = null;
  let regR2 = 0;
  if (ridgeResult) {
    regR2 = ridgeResult.r2;
    const alpha = ridgeResult.betas[0];
    const betas = ridgeResult.betas.slice(1);
    const betaSum = betas.reduce((s, v) => s + v, 0);

    regressionWeights = availableStocks.map((st, i) => ({
      tq: st.tq, code: st.code, name: st.name,
      publishedPct: st.percent,
      beta: betas[i],
      weight: betaSum > 0 ? betas[i] / betaSum : 0,
      alpha,
    }));
  }

  // Method 3: NNLS — 非负最小二乘，直接约束权重≥0且自动归一化
  let nnlsWeights = null;
  let nnlsR2 = 0;
  const nnlsResult = solveNNLS(y, X);
  if (nnlsResult) {
    nnlsR2 = nnlsResult.r2;
    nnlsWeights = availableStocks.map((st, i) => ({
      tq: st.tq, code: st.code, name: st.name,
      publishedPct: st.percent,
      finalWeight: nnlsResult.weights[i],
    }));
  }

  return {
    samples: n,
    reportDate: holdingsData.reportDate,
    availableStocks: availableStocks.length,
    totalStocks: stocks.length,
    simpleWeights,
    regressionR2: regR2,
    constrainedR2: nnlsR2,
    constrainedWeights: nnlsWeights,
  };
}

export async function trainAllFunds(holdingsMap, navDataMap) {
  const results = {};
  const fundCodes = Object.keys(holdingsMap);

  for (let i = 0; i < fundCodes.length; i++) {
    const code = fundCodes[i];
    const hData = holdingsMap[code];
    if (!hData?.holdings?.length) {
      results[code] = { status: 'skipped', note: hData?.note || 'no_holdings' };
      continue;
    }

    const navData = navDataMap[code];
    if (!navData?.length) {
      results[code] = { status: 'skipped', note: 'no_nav_data' };
      continue;
    }

    process.stdout.write(`\n[${i + 1}/${fundCodes.length}] ${code}`);
    const result = await trainStockWeights(code, hData, navData);

    if (result) {
      results[code] = { status: 'done', ...result };
      const tag = result.constrainedR2 > 0.8 ? '✅' : result.constrainedR2 > 0.6 ? '👍' : result.constrainedR2 > 0.4 ? '⚠️' : result.constrainedR2 > 0 ? '🔶' : '❌';
      console.log(`  ${tag} RidgeR²=${(result.regressionR2 * 100).toFixed(1)}% NNLS-R²=${(result.constrainedR2 * 100).toFixed(1)}% 样本=${result.samples}日`);
    } else {
      results[code] = { status: 'failed' };
      console.log(`  ❌ 回归失败`);
    }
  }

  return results;
}