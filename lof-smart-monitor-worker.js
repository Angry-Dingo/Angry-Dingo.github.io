export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day = now.getUTCDay();
    const cron = event.cron;

    const beijingHour = (hour + 8) % 24;
    const beijingDay = (hour + 8 >= 24) ? (day + 1) % 7 : day;

    console.log(`[LOG] UTC: ${hour}:${minute}, 星期: ${day}, 北京: ${beijingHour}:${minute}, 星期: ${beijingDay}, Cron: ${cron}`);

    // 收盘快照：北京时间 15:00（UTC 07:00），交易日执行
    if (cron.startsWith('0 7') && beijingDay >= 1 && beijingDay <= 5) {
      console.log('[LOG] 执行收盘快照任务');
      ctx.waitUntil(saveDailySnapshot(env));
      return;
    }

    // 使用 startsWith 前缀匹配，兼容 Dashboard 上的各种 cron 变体（如 0 23 * * 0-4 / 0 23 * * *）
    if (cron.startsWith('0 23')) {
      console.log('[LOG] 执行数据同步任务');
      ctx.waitUntil(syncDataFromGitHub(env));
    } else if (cron.startsWith('10 13')) {
      // 晚上21:10数据同步，执行同步但不推送飞书
      console.log('[LOG] 执行数据同步任务（不推送飞书）');
      ctx.waitUntil(syncDataFromGitHub(env, false));
    } else {
      console.log('[LOG] 执行溢价监控任务');
      ctx.waitUntil(smartMonitor(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/test') {
      ctx.waitUntil(smartMonitor(env, true));
      return new Response('测试已触发', { status: 200 });
    }
    if (url.pathname === '/sync') {
      ctx.waitUntil(syncDataFromGitHub(env));
      return new Response('数据同步已触发', { status: 200 });
    }
    if (url.pathname === '/snapshot') {
      ctx.waitUntil(saveDailySnapshot(env));
      return new Response('收盘快照已触发', { status: 200 });
    }
    // 指数数据代理：浏览器端通过此端点获取东方财富指数数据（服务端无CORS限制）
    if (url.pathname === '/api/indices') {
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
      ];
      const results = {};
      const times = {};
      await Promise.all(EM_CODES.map(async ([key, secid]) => {
        try {
          const r = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f169,f170,f3,f14&_=${Date.now()}`);
          const d = await r.json();
          if (d.data) {
            const chg = d.data.f3 !== undefined ? d.data.f3 : ((d.data.f170 || 0) / 100);
            const time = d.data.f14 || '';
            results[key] = chg;
            times[key] = time;
          }
        } catch (e) {}
      }));
      return new Response(JSON.stringify({ data: results, times }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 期货数据代理：浏览器端通过此端点获取沪银主连数据（服务端无CORS/Referer限制）
    if (url.pathname === '/api/futures') {
      return await handleFuturesProxy();
    }
    return new Response('LOF 基金监控服务', { status: 200 });
  }
};

// ==================== 期货数据代理 ====================
async function handleFuturesProxy() {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  };

  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.AGM&fields=f43,f170,f3,f14&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data) {
        const chg = emData.data.f3;
        if (chg !== undefined && chg !== null) {
          return new Response(JSON.stringify({ nf_AG0: chg, source: 'eastmoney_A' }), { headers });
        }
      }
    }
  } catch (e) {}

  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.agm&fields=f43,f170,f3,f14&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data) {
        const chg = emData.data.f3;
        if (chg !== undefined && chg !== null) {
          return new Response(JSON.stringify({ nf_AG0: chg, source: 'eastmoney_B' }), { headers });
        }
      }
    }
  } catch (e) {}

  try {
    const sinaRes = await fetch('https://hq.sinajs.cn/list=nf_AG0', {
      headers: { 'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await sinaRes.text();
    const match = text.match(/hq_str_nf_AG0="([^"]+)"/);
    if (match) {
      const parts = match[1].split(',');
      const currentPrice = parseFloat(parts[6]);
      let prevClose = parseFloat(parts[5]);
      if (!prevClose || prevClose <= 0) prevClose = parseFloat(parts[10]);
      if (currentPrice > 0 && prevClose > 0) {
        const chg = (currentPrice - prevClose) / prevClose * 100;
        return new Response(JSON.stringify({ nf_AG0: parseFloat(chg.toFixed(2)), source: 'sina' }), { headers });
      }
    }
  } catch (e) {}

  return new Response(JSON.stringify({ nf_AG0: null, source: 'none' }), { headers });
}

async function fetchFuturesData() {
  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.AGM&fields=f43,f3&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data && emData.data.f3 !== undefined) {
        return { 'nf_AG0': emData.data.f3 };
      }
    }
  } catch (e) {}
  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.agm&fields=f43,f3&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data && emData.data.f3 !== undefined) {
        return { 'nf_AG0': emData.data.f3 };
      }
    }
  } catch (e) {}

  try {
    const sinaRes = await fetch('https://hq.sinajs.cn/list=nf_AG0', {
      headers: { 'Referer': 'https://finance.sina.com.cn' }
    });
    const text = await sinaRes.text();
    const match = text.match(/hq_str_nf_AG0="([^"]+)"/);
    if (match) {
      const parts = match[1].split(',');
      const currentPrice = parseFloat(parts[6]);
      let prevClose = parseFloat(parts[5]);
      if (!prevClose || prevClose <= 0) prevClose = parseFloat(parts[10]);
      if (currentPrice > 0 && prevClose > 0) {
        const chg = (currentPrice - prevClose) / prevClose * 100;
        return { 'nf_AG0': parseFloat(chg.toFixed(2)) };
      }
    }
  } catch (e) {}
  return {};
}

function quotaIcon(quota) {
  if (!quota) return '⚪';
  if (quota === '暂停') return '🔴';
  if (quota === '开放') return '🟢';
  return '🟠';
}

async function syncDataFromGitHub(env, sendAlert = true) {
  try {
    console.log('[LOG] === 开始数据同步任务 ===');
    const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
    const fundsData = await res.json();
    console.log(`[LOG] 从GitHub加载 ${fundsData.funds.length} 只基金`);

    let changes = [];
    if (env.FUNDS_KV) {
      const oldData = await env.FUNDS_KV.get('funds');
      if (oldData) {
        const oldFunds = JSON.parse(oldData);
        const oldQuotaMap = {};
        oldFunds.funds.forEach(f => { oldQuotaMap[f.code] = f.quota; });
        fundsData.funds.forEach(f => {
          if (f.quota !== oldQuotaMap[f.code]) {
            changes.push({ code: f.code, name: f.name, oldQuota: oldQuotaMap[f.code] || '未知', newQuota: f.quota });
          }
        });
      }
    }

    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
      console.log('[LOG] KV 存储成功');
    }

    await backfillActualNav(env, fundsData.funds);
    if (sendAlert) {
      await sendQuotaUpdateAlert(env, fundsData.funds.length, changes);
    }
    console.log('[LOG] 数据同步任务完成');
  } catch (error) {
    console.error('[ERROR] 数据同步任务失败:', error.message);
  }
}

// 判断当前北京时间是否为工作日（周一至周五）
function isBeijingTradingDay() {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  const beijingDay = (hour + 8 >= 24) ? (day + 1) % 7 : day;
  return beijingDay >= 1 && beijingDay <= 5;
}

async function sendQuotaUpdateAlert(env, totalCount, changes) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 未配置飞书Webhook，跳过发送');
    return;
  }
  if (!isBeijingTradingDay()) {
    console.log('[LOG] 非工作日，跳过飞书推送');
    return;
  }
  const now = Date.now();
  const lastSendTime = await env.FUNDS_KV?.get('lastQuotaAlertTime');
  if (lastSendTime && now - parseInt(lastSendTime) < 5 * 60 * 1000) {
    console.log('[LOG] 5分钟内已发送过申购状态更新通知，跳过');
    return;
  }
  try {
    const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let msg = `📊 申购状态更新完成 (${t})\n\n`;
    msg += `总计获取: ${totalCount} 只基金\n`;
    msg += `状态变化: ${changes.length} 只基金\n`;
    if (changes.length > 0) {
      msg += '\n📋 变化列表:\n';
      changes.forEach(({ code, name, oldQuota, newQuota }) => {
        const oldIcon = quotaIcon(oldQuota);
        const newIcon = quotaIcon(newQuota);
        msg += `• ${code} ${name}: ${oldIcon}${oldQuota} → ${newIcon}${newQuota}\n`;
      });
    }
    const response = await fetch(env.FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });
    if (response.ok) {
      await env.FUNDS_KV?.put('lastQuotaAlertTime', now.toString());
      console.log('[LOG] 申购状态更新通知已发送');
    } else {
      console.error('[ERROR] 飞书通知发送失败:', response.status);
    }
  } catch (error) {
    console.error('[ERROR] 发送申购状态通知失败:', error.message);
  }
}

const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const m = now.getUTCMinutes();
    const day = now.getUTCDay();
    const h = (hour + 8) % 24;
    const d = (hour + 8 >= 24) ? (day + 1) % 7 : day;
    console.log(`[LOG] smartMonitor - 北京时间: ${h}:${m}, 星期: ${d}`);

    const isTrading = isTestMode || (
      (d >= 1 && d <= 5) && (
        (h === 9 && m >= 25) || (h === 10) || (h === 11 && m <= 30) || (h === 13 && m >= 0) || (h === 14) || (h === 15 && m <= 0)
      )
    );
    if (!isTrading) {
      console.log('[LOG] 不在交易时间，跳过');
      return;
    }

    const fundsData = await loadFundsData(env);
    const { fundMarketData, indexData } = await fetchMarketData(fundsData);
    const alerts = [];
    const allAbnormalFunds = [];

    const isGlobalAlert = isTestMode || (
      (h === 9 && m >= 25 && m <= 26) ||
      (h === 10 && (m <= 1 || (m >= 30 && m <= 31))) ||
      (h === 11 && (m <= 1 || (m >= 30 && m <= 31))) ||
      (h === 13 && (m <= 1 || (m >= 30 && m <= 31))) ||
      (h === 14 && (m <= 1 || (m >= 30 && m <= 31)))
    );
    console.log(`[LOG] isGlobalAlert: ${isGlobalAlert}`);

    for (const fund of fundsData.funds) {
      const mi = fundMarketData[fund.tq];
      if (!mi) continue;
      const baseNav = fund.officialNav || mi.prevClose;
      if (!baseNav) continue;
      const benchChg = fund.benchmark ? calculateBenchChgPct(fund.benchmark, indexData) : 0;
      const nav = baseNav * (1 + benchChg / 100);
      const premium = ((mi.price - nav) / nav) * 100;
      const threshold = fund.premiumThreshold || 2;

      if (isTestMode || Math.abs(premium) >= threshold) {
        allAbnormalFunds.push({ fund, premiumRate: premium });
        if (!isTestMode) {
          const alert = checkDynamicChange(fund.code, premium);
          if (alert) alerts.push(alert);
        }
      }
    }

    if (allAbnormalFunds.length > 0) {
      console.log('[LOG] 异常基金详情:');
      allAbnormalFunds.forEach(({ fund, premiumRate }) => {
        console.log(`[LOG]   ${fund.code} ${fund.name}: ${premiumRate.toFixed(2)}%`);
      });
    }

    if (isGlobalAlert) {
      if (allAbnormalFunds.length > 0) {
        await sendGlobalAlert(env, allAbnormalFunds);
      }
    } else {
      if (alerts.length > 0) {
        await sendDynamicAlerts(env, alerts, fundsData);
      }
    }
  } catch (e) {
    console.error('[ERROR] 监控失败:', e);
  }
}

function calculateBenchChgPct(bench, indexData) {
  if (Array.isArray(bench)) {
    let w = 0, c = 0;
    bench.forEach(b => { c += (indexData[b.tq] || 0) * b.w; w += b.w; });
    return w > 0 ? c / w : 0;
  }
  if (bench && typeof bench === 'object') return indexData[bench.tq] || 0;
  if (bench) return indexData[bench] || 0;
  return 0;
}

function checkDynamicChange(code, premium) {
  const now = Date.now();
  if (!PREMIUM_HISTORY[code]) PREMIUM_HISTORY[code] = [];
  PREMIUM_HISTORY[code].push({ t: now, p: premium });
  if (PREMIUM_HISTORY[code].length > 10) PREMIUM_HISTORY[code].shift();
  const recent = PREMIUM_HISTORY[code].filter(h => h.t > now - 5 * 60 * 1000);
  if (recent.length < 2) return null;
  const avg = recent.reduce((s, h) => s + h.p, 0) / recent.length;
  const change = premium - avg;
  if (Math.abs(change) >= 0.8 && Math.abs(premium) >= 2 && (now - (LAST_ALERT_TIME[code] || 0) > 5 * 60 * 1000)) {
    LAST_ALERT_TIME[code] = now;
    return { fundCode: code, premium, change, type: change > 0 ? '溢价上升' : '折价加深' };
  }
  return null;
}

async function loadFundsData(env) {
  try {
    const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
    const data = await res.json();
    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(data, null, 2));
    }
    return data;
  } catch (e) {
    console.error('[ERROR] 从GitHub拉取数据失败，回退到KV:', e.message);
    if (env.FUNDS_KV) {
      const d = await env.FUNDS_KV.get('funds');
      if (d) return JSON.parse(d);
    }
    throw e;
  }
}

async function fetchMarketData(fundsData) {
  const fundTqs = fundsData.funds.map(f => f.tq);
  const all = [...new Set([...fundTqs, ...fundsData.funds.flatMap(f =>
    Array.isArray(f.benchmark) ? f.benchmark.map(b => b.tq) :
    f.benchmark?.tq ? [f.benchmark.tq] : f.benchmark ? [f.benchmark] : []
  )])].join(',');
  const res = await fetch(`https://qt.gtimg.cn/q=${all}&_=${Date.now()}`);
  const text = await res.text();
  const fundMarketData = {};
  const indexData = {};
  const fundSet = new Set(fundTqs);
  text.split(';').forEach(line => {
    const m = line.match(/v_(\w+)="([^"]+)"/);
    if (!m) return;
    const p = m[2].split('~');
    if (p.length < 10) return;
    const price = parseFloat(p[3]), prev = parseFloat(p[4]);
    if (price > 0) {
      const chg = prev > 0 ? (price - prev) / prev * 100 : 0;
      if (fundSet.has(m[1])) fundMarketData[m[1]] = { price, prevClose: prev, change: chg };
      else indexData[m[1]] = chg;
    }
  });

  const EM_CODES = [
    ['csi930917', '2.930917'], ['csi930914', '2.930914'], ['csi930792', '2.930792'],
    ['sh000985',  '1.000985'], ['sh000066',  '1.000066'], ['sh000945',  '1.000945'],
    ['hkHSMI',    '124.HSMI'], ['hkHSSI',    '124.HSSI'], ['hkHSCI',    '124.HSCI'],
    ['hkHSI',     '124.HSI'],
  ];
  await Promise.all(EM_CODES.map(async ([tq, secid]) => {
    try {
      const r = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f170,f3&_=${Date.now()}`);
      const d = await r.json();
      if (d.data) {
        const chg = d.data.f3 !== undefined ? d.data.f3 : ((d.data.f170 || 0) / (d.data.f43 || 100) * 100);
        if (chg != null) indexData[tq] = chg;
      }
    } catch (e) {}
  }));

  try {
    const futuresData = await fetchFuturesData();
    if (futuresData['nf_AG0'] !== undefined && futuresData['nf_AG0'] !== null) {
      indexData['nf_AG0'] = futuresData['nf_AG0'];
    }
  } catch (e) {}

  if (indexData['hkHSMI'] == null || indexData['hkHSMI'] === 0) {
    if (indexData['hkHSI'] != null) indexData['hkHSMI'] = indexData['hkHSI'];
  }
  if (indexData['hkHSCI'] == null || indexData['hkHSCI'] === 0) {
    if (indexData['hkHSI'] != null) indexData['hkHSCI'] = indexData['hkHSI'];
  }
  if (indexData['hkHSSI'] == null || indexData['hkHSSI'] === 0) {
    if (indexData['hkHSI'] != null) indexData['hkHSSI'] = indexData['hkHSI'];
  }

  return { fundMarketData, indexData };
}

async function sendGlobalAlert(env, funds) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 未配置飞书Webhook，跳过发送');
    return;
  }
  if (!isBeijingTradingDay()) {
    console.log('[LOG] 非工作日，跳过飞书推送');
    return;
  }
  const now = new Date();
  const timeKey = `${now.getHours()}:${now.getMinutes()}`;
  const lockKey = `globalAlertLock_${timeKey}`;
  try {
    const existingLock = await env.FUNDS_KV?.get(lockKey);
    if (existingLock) {
      console.log('[LOG] 相同时间已发送过全局提醒，跳过');
      return;
    }
    const sorted = [...funds].sort((a, b) => b.premiumRate - a.premiumRate);
    const t = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let msg = `📈 溢价提醒 - 全局汇总\n检测时间: ${t}\n\n`;
    sorted.forEach(({ fund, premiumRate }) => {
      const p = premiumRate >= 0 ? `+${premiumRate.toFixed(2)}%` : `${premiumRate.toFixed(2)}%`;
      const icon = quotaIcon(fund.quota);
      msg += `• ${fund.code} ${fund.name}: ${p}  ${icon}${fund.quota || '未知'}\n`;
    });
    const response = await fetch(env.FEISHU_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });
    if (response.ok) {
      await env.FUNDS_KV?.put(lockKey, '1', { expirationTtl: 120 });
      console.log('[LOG] 全局溢价提醒已发送');
    }
  } catch (error) {
    console.error('[ERROR] 发送全局溢价提醒失败:', error.message);
  }
}

async function sendDynamicAlerts(env, alerts, fundsData) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 未配置飞书Webhook，跳过发送');
    return;
  }
  if (!isBeijingTradingDay()) {
    console.log('[LOG] 非工作日，跳过飞书推送');
    return;
  }
  const lockKey = 'dynamicAlertLock';
  try {
    const existingLock = await env.FUNDS_KV?.get(lockKey);
    if (existingLock) {
      console.log('[LOG] 2分钟内已发送过动态提醒，跳过');
      return;
    }
    const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let msg = `📊 溢价提醒 - 动态变化\n检测时间: ${t}\n\n`;
    alerts.forEach(a => {
      const f = fundsData.funds.find(x => x.code === a.fundCode);
      const icon = quotaIcon(f?.quota);
      msg += `• ${a.fundCode} ${f?.name || a.fundCode}: ${a.type}\n  当前: ${a.premium.toFixed(2)}%  变化: ${a.change.toFixed(2)}%  ${icon}${f?.quota || '未知'}\n`;
    });
    const response = await fetch(env.FEISHU_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });
    if (response.ok) {
      await env.FUNDS_KV?.put(lockKey, '1', { expirationTtl: 120 });
      console.log('[LOG] 动态溢价提醒已发送');
    }
  } catch (error) {
    console.error('[ERROR] 发送动态溢价提醒失败:', error.message);
  }
}

async function saveDailySnapshot(env) {
  try {
    console.log('[LOG] === 开始收盘快照任务 ===');
    const fundsData = await loadFundsData(env);
    const { fundMarketData, indexData } = await fetchMarketData(fundsData);
    const now = new Date();
    const beijingDate = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    console.log(`[LOG] 快照日期: ${beijingDate}`);

    let saved = 0;
    for (const fund of fundsData.funds) {
      const mi = fundMarketData[fund.tq];
      if (!mi) continue;
      const baseNav = fund.officialNav || mi.prevClose;
      if (!baseNav) continue;
      const benchChg = fund.benchmark ? calculateBenchChgPct(fund.benchmark, indexData) : 0;
      const estNav = baseNav * (1 + benchChg / 100);
      if (estNav <= 0) continue;

      const key = `nav_hist:${fund.code}`;
      let history = [];
      try {
        const raw = await env.FUNDS_KV.get(key);
        if (raw) history = JSON.parse(raw);
      } catch (e) {}

      let todayEntry = history.find(h => h.date === beijingDate);
      if (todayEntry) {
        todayEntry.estNav = parseFloat(estNav.toFixed(4));
      } else {
        history.push({ date: beijingDate, estNav: parseFloat(estNav.toFixed(4)), actualNav: null });
      }

      if (history.length > 20) history = history.slice(-20);
      await env.FUNDS_KV.put(key, JSON.stringify(history));
      saved++;
    }
    console.log(`[LOG] 收盘快照完成，共保存 ${saved} 只基金的预估净值`);
  } catch (e) {
    console.error('[ERROR] 收盘快照失败:', e.message);
  }
}

async function backfillActualNav(env, funds) {
  if (!env.FUNDS_KV) return;
  let updated = 0;
  // 分批处理，避免超时（每批10只）
  const batchSize = 10;
  for (let i = 0; i < funds.length; i += batchSize) {
    const batch = funds.slice(i, i + batchSize);
    await Promise.all(batch.map(async (fund) => {
      try {
        // 优先从东方财富 fundgz 接口获取最新实际净值
        let actualNav = null;
        let navDate = null;
        try {
          const res = await fetch(`https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          const text = await res.text();
          const match = text.match(/jsonpgz\((.+)\)/);
          if (match) {
            const data = JSON.parse(match[1]);
            if (data.dwjz) actualNav = parseFloat(data.dwjz);
            if (data.jzrq) navDate = data.jzrq;
          }
        } catch (e) {
          console.log(`[LOG] fundgz接口获取 ${fund.code} 失败，回退到funds.json`);
        }
        // 回退：使用 funds.json 中的 officialNav
        if (actualNav === null && fund.officialNav && fund.navDate) {
          actualNav = fund.officialNav;
          navDate = fund.navDate;
        }
        if (actualNav === null || !navDate) return;

        const key = `nav_hist:${fund.code}`;
        let history = [];
        try {
          const raw = await env.FUNDS_KV.get(key);
          if (raw) history = JSON.parse(raw);
        } catch (e) {}
        if (history.length === 0) return;

        let found = false;
        for (const entry of history) {
          if (entry.date === navDate) {
            entry.actualNav = actualNav;
            found = true;
            break;
          }
        }
        if (!found) {
          history.push({ date: navDate, estNav: null, actualNav: actualNav });
          if (history.length > 20) history = history.slice(-20);
        }
        await env.FUNDS_KV.put(key, JSON.stringify(history));
        updated++;
      } catch (e) {
        console.error(`[ERROR] 回填 ${fund.code} 失败:`, e.message);
      }
    }));
  }
  console.log(`[LOG] 回填实际净值完成，共更新 ${updated} 只基金`);
}