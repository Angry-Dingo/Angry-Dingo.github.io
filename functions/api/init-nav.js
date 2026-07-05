// CF Pages Function - 初始化净值历史数据
// 一次性脚本：拉取过去15天实际净值 + 今日预估净值快照
// 调用方式: /api/init-nav
// 功能：
//   1. 从天天基金 pingzhongdata 拉取每只基金过去15天的单位净值(actualNav)
//   2. 从腾讯/东财拉取实时行情，计算今日预估净值(estNav)并写入KV
// 明天起由 Worker saveDailySnapshot 自然积累

export async function onRequest(context) {
  const { env } = context;

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

  const results = {
    total: fundsData.funds.length,
    historySuccess: 0,
    historyFailed: 0,
    snapshotCount: 0,
    date: beijingDate,
    details: []
  };

  // ========== 2. 批量拉取历史实际净值（方案3） ==========
  const BATCH = 8;
  for (let i = 0; i < fundsData.funds.length; i += BATCH) {
    const batch = fundsData.funds.slice(i, i + BATCH);
    await Promise.all(batch.map(async (fund) => {
      try {
        const res = await fetch(
          `https://fund.eastmoney.com/pingzhongdata/${fund.code}.js?v=${Date.now()}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
        );
        const text = await res.text();

        // 解析 Data_netWorthTrend 数组
        const startIdx = text.indexOf('Data_netWorthTrend');
        if (startIdx === -1) {
          results.historyFailed++;
          results.details.push({ code: fund.code, status: 'no_trend_data' });
          return;
        }
        const arrStart = text.indexOf('[', startIdx);
        const arrEnd = text.indexOf('];', arrStart);
        if (arrStart === -1 || arrEnd === -1) {
          results.historyFailed++;
          results.details.push({ code: fund.code, status: 'parse_error' });
          return;
        }
        const arrStr = text.substring(arrStart, arrEnd + 1);
        const navTrend = JSON.parse(arrStr);

        // 取最近15条，构建历史记录
        const recent = navTrend.slice(-15);
        const history = recent.map(item => {
          const bjDate = new Date(item.x + 8 * 3600000).toISOString().slice(0, 10);
          return {
            date: bjDate,
            estNav: null,
            actualNav: parseFloat(item.y) || null
          };
        }).filter(r => r.actualNav !== null);

        // 写入 KV
        const key = `nav_hist:${fund.code}`;
        await env.FUNDS_KV.put(key, JSON.stringify(history));
        results.historySuccess++;
        results.details.push({ code: fund.code, status: 'ok', days: history.length });
      } catch (e) {
        results.historyFailed++;
        results.details.push({ code: fund.code, status: 'error', error: e.message });
      }
    }));
  }

  // ========== 3. 拉取实时行情，计算今日预估净值快照（方案2） ==========
  try {
    // 3.1 腾讯行情
    const fundTqs = fundsData.funds.map(f => f.tq);
    const idxTqs = [...new Set(fundsData.funds.flatMap(f =>
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

    // 3.2 东方财富补充指数
    const EM_CODES = [
      ['csi930917', '2.930917'],
      ['csi930914', '2.930914'],
      ['csi930792', '2.930792'],
      ['sh000985',  '1.000985'],
      ['sh000066',  '1.000066'],
      ['sh000945',  '1.000945'],
      ['hkHSMI',    '124.HSMI'],
      ['hkHSSI',    '124.HSSI'],
      ['hkHSCI',    '124.HSCI'],
      ['hkHSI',     '124.HSI'],
    ];
    await Promise.all(EM_CODES.map(async ([key, secid]) => {
      try {
        const r = await fetch(
          `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f170,f3&_=${Date.now()}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const d = await r.json();
        if (d.data) {
          const chg = d.data.f3 !== undefined ? d.data.f3 : ((d.data.f170 || 0) / 100);
          indexData[key] = chg;
        }
      } catch (e) {}
    }));

    // 3.3 沪银主连期货
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

    // 3.4 指数降级
    if (indexData['hkHSMI'] == null || indexData['hkHSMI'] === 0) {
      if (indexData['hkHSI'] != null) indexData['hkHSMI'] = indexData['hkHSI'];
    }
    if (indexData['hkHSCI'] == null || indexData['hkHSCI'] === 0) {
      if (indexData['hkHSI'] != null) indexData['hkHSCI'] = indexData['hkHSI'];
    }
    if (indexData['hkHSSI'] == null || indexData['hkHSSI'] === 0) {
      if (indexData['hkHSI'] != null) indexData['hkHSSI'] = indexData['hkHSI'];
    }

    // 3.5 计算今日 estNav 并更新 KV
    for (const fund of fundsData.funds) {
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
        // 保留已回填的 actualNav
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
