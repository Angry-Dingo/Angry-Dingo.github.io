// CF Pages Function - 初始化净值历史数据（分批模式）
// 调用方式: /api/init-nav          → 返回总批数和基金列表
//           /api/init-nav?batch=1  → 执行第1批（约5只基金）
//           /api/init-nav?batch=2  → 执行第2批，以此类推
// 明天起由 Worker saveDailySnapshot 自然积累

const BATCH_SIZE = 5; // 每批处理5只，避免CF Pages Function超时

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const batchNum = parseInt(url.searchParams.get('batch') || '0');

  if (!env.FUNDS_KV) {
    return new Response(JSON.stringify({ error: 'FUNDS_KV 未配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const beijingDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  // ========== 1. 加载基金列表 ==========
  let fundsData;
  try {
    const fundsRaw = await env.FUNDS_KV.get('funds');
    if (fundsRaw) {
      fundsData = JSON.parse(fundsRaw);
    } else {
      const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
      fundsData = await res.json();
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: '加载基金数据失败: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const totalFunds = fundsData.funds.length;
  const totalBatches = Math.ceil(totalFunds / BATCH_SIZE);

  // 无 batch 参数：返回总览信息
  if (!batchNum) {
    return new Response(JSON.stringify({
      message: '分批初始化净值历史数据',
      totalFunds,
      totalBatches,
      batchSize: BATCH_SIZE,
      usage: `依次调用 /api/init-nav?batch=1 到 /api/init-nav?batch=${totalBatches}`,
      funds: fundsData.funds.map((f, i) => ({
        code: f.code,
        name: f.name,
        batch: Math.floor(i / BATCH_SIZE) + 1
      }))
    }, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ========== 2. 执行指定批次 ==========
  const startIdx = (batchNum - 1) * BATCH_SIZE;
  const endIdx = Math.min(startIdx + BATCH_SIZE, totalFunds);
  const batchFunds = fundsData.funds.slice(startIdx, endIdx);

  if (batchNum < 1 || batchNum > totalBatches) {
    return new Response(JSON.stringify({
      error: `批次号无效，范围 1~${totalBatches}`
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const results = {
    batch: batchNum,
    totalBatches,
    fundsInBatch: batchFunds.length,
    date: beijingDate,
    historySuccess: 0,
    historyFailed: 0,
    snapshotCount: 0,
    details: []
  };

  // 2.1 拉取历史实际净值
  await Promise.all(batchFunds.map(async (fund) => {
    try {
      const res = await fetch(
        `https://fund.eastmoney.com/pingzhongdata/${fund.code}.js?v=${Date.now()}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      );
      const text = await res.text();

      const startIdx2 = text.indexOf('Data_netWorthTrend');
      if (startIdx2 === -1) {
        results.historyFailed++;
        results.details.push({ code: fund.code, name: fund.name, status: 'no_trend_data' });
        return;
      }
      const arrStart = text.indexOf('[', startIdx2);
      const arrEnd = text.indexOf('];', arrStart);
      if (arrStart === -1 || arrEnd === -1) {
        results.historyFailed++;
        results.details.push({ code: fund.code, name: fund.name, status: 'parse_error' });
        return;
      }
      const arrStr = text.substring(arrStart, arrEnd + 1);
      const navTrend = JSON.parse(arrStr);

      const recent = navTrend.slice(-15);
      const history = recent.map(item => {
        const bjDate = new Date(item.x + 8 * 3600000).toISOString().slice(0, 10);
        return {
          date: bjDate,
          estNav: null,
          actualNav: parseFloat(item.y) || null
        };
      }).filter(r => r.actualNav !== null);

      const key = `nav_hist:${fund.code}`;
      await env.FUNDS_KV.put(key, JSON.stringify(history));
      results.historySuccess++;
      results.details.push({ code: fund.code, name: fund.name, status: 'ok', days: history.length });
    } catch (e) {
      results.historyFailed++;
      results.details.push({ code: fund.code, name: fund.name, status: 'error', error: e.message });
    }
  }));

  // 2.2 拉取实时行情，计算今日预估净值快照
  try {
    const fundTqs = batchFunds.map(f => f.tq);
    const idxTqs = [...new Set(batchFunds.flatMap(f =>
      Array.isArray(f.benchmark) ? f.benchmark.map(b => b.tq) :
      f.benchmark ? [f.benchmark] : []
    ))];
    const allTqs = [...new Set([...fundTqs, ...idxTqs])].join(',');

    const qtRes = await fetch(`https://qt.gtimg.cn/q=${allTqs}&_=${Date.now()}`);
    const qtText = await qtRes.text();

    const fundMarketData = {};
    const indexData = {};
    const fundSet = new Set(fundTqs);

    qtText.split(';').forEach(line => {
      const m = line.match(/v_(\w+)="([^"]+)"/);
      if (!m) return;
      const p = m[2].split('~');
      if (p.length < 10) return;
      const price = parseFloat(p[3]);
      const prev = parseFloat(p[4]);
      if (price > 0) {
        const chg = prev > 0 ? (price - prev) / prev * 100 : 0;
        if (fundSet.has(m[1])) {
          fundMarketData[m[1]] = { price, prevClose: prev, change: chg };
        } else {
          indexData[m[1]] = chg;
        }
      }
    });

    // 东方财富补充指数
    const EM_CODES = [
      ['csi930917', '2.930917'], ['csi930914', '2.930914'], ['csi930792', '2.930792'],
      ['sh000985', '1.000985'], ['sh000066', '1.000066'], ['sh000945', '1.000945'],
      ['hkHSMI', '124.HSMI'], ['hkHSSI', '124.HSSI'], ['hkHSCI', '124.HSCI'], ['hkHSI', '124.HSI'],
    ];
    await Promise.all(EM_CODES.map(async ([key, secid]) => {
      try {
        const r = await fetch(
          `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f170,f3&_=${Date.now()}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const d = await r.json();
        if (d.data) {
          indexData[key] = d.data.f3 !== undefined ? d.data.f3 : ((d.data.f170 || 0) / 100);
        }
      } catch (e) {}
    }));

    // 沪银主连期货
    try {
      const futRes = await fetch(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=113.AGM&fields=f43,f170,f3&_=${Date.now()}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const futData = await futRes.json();
      if (futData.data && futData.data.f3 !== undefined) {
        indexData['nf_AG0'] = futData.data.f3;
      }
    } catch (e) {}

    // 指数降级
    if (indexData['hkHSMI'] == null || indexData['hkHSMI'] === 0) {
      if (indexData['hkHSI'] != null) indexData['hkHSMI'] = indexData['hkHSI'];
    }
    if (indexData['hkHSCI'] == null || indexData['hkHSCI'] === 0) {
      if (indexData['hkHSI'] != null) indexData['hkHSCI'] = indexData['hkHSI'];
    }
    if (indexData['hkHSSI'] == null || indexData['hkHSSI'] === 0) {
      if (indexData['hkHSI'] != null) indexData['hkHSSI'] = indexData['hkHSI'];
    }

    // 计算今日 estNav
    for (const fund of batchFunds) {
      const mi = fundMarketData[fund.tq];
      if (!mi) continue;
      const baseNav = fund.officialNav || mi.prevClose;
      if (!baseNav) continue;

      const benchChg = fund.benchmark ? calcBenchChg(fund.benchmark, indexData) : 0;
      const estNav = baseNav * (1 + benchChg / 100);
      if (estNav <= 0) continue;

      const record = {
        date: beijingDate,
        estNav: parseFloat(estNav.toFixed(4)),
        actualNav: fund.officialNav || null
      };

      const key = `nav_hist:${fund.code}`;
      const existing = await env.FUNDS_KV.get(key, 'json') || [];
      const todayIdx = existing.findIndex(r => r.date === beijingDate);

      if (todayIdx >= 0) {
        if (existing[todayIdx].actualNav !== null && existing[todayIdx].actualNav !== undefined) {
          record.actualNav = existing[todayIdx].actualNav;
        }
        existing[todayIdx] = record;
      } else {
        existing.push(record);
      }

      const sorted = existing.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
      await env.FUNDS_KV.put(key, JSON.stringify(sorted));
      results.snapshotCount++;
    }
  } catch (e) {
    results.snapshotError = e.message;
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function calcBenchChg(bench, indexData) {
  if (Array.isArray(bench)) {
    let w = 0, c = 0;
    bench.forEach(b => { c += (indexData[b.tq] || 0) * b.w; w += b.w; });
    return w > 0 ? c / w : 0;
  }
  if (bench && typeof bench === 'object') return indexData[bench.tq] || 0;
  if (bench) return indexData[bench] || 0;
  return 0;
}
