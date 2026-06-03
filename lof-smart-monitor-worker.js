export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day = now.getUTCDay();
    const cron = event.cron;

    // 转换为北京时间
    const beijingHour = (hour + 8) % 24;
    const beijingDay = (hour + 8 >= 24) ? (day + 1) % 7 : day;
    
    console.log(`[LOG] UTC时间: ${hour}:${minute}, 星期: ${day}, 北京时间: ${beijingHour}:${minute}, 星期: ${beijingDay}, Cron: ${cron}`);

    // ✅ 判断任务类型
    // 每10分钟执行数据更新
    const isUpdateTime = (minute % 10 === 0);
    
    if (isUpdateTime) {
      console.log('[LOG] 执行数据更新任务（每10分钟）');
      ctx.waitUntil(updateDataTask(env));
    } else {
      console.log('[LOG] 执行溢价监控任务（Cron触发）');
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
    return new Response('LOF 基金监控服务', { status: 200 });
  }
};

// ==================== 数据同步任务 ====================
async function syncDataFromGitHub(env) {
  try {
    console.log('[LOG] === 开始数据同步任务 ===');
    
    // 从GitHub拉取最新数据
    const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
    const fundsData = await res.json();
    console.log(`[LOG] 从GitHub加载 ${fundsData.funds.length} 只基金`);
    
    // 计算申购状态变化
    let changes = [];
    if (env.FUNDS_KV) {
      const oldData = await env.FUNDS_KV.get('funds');
      if (oldData) {
        const oldFunds = JSON.parse(oldData);
        const oldQuotaMap = {};
        oldFunds.funds.forEach(f => { oldQuotaMap[f.code] = f.quota; });
        
        fundsData.funds.forEach(f => {
          if (f.quota !== oldQuotaMap[f.code]) {
            changes.push({
              code: f.code,
              name: f.name,
              oldQuota: oldQuotaMap[f.code] || '未知',
              newQuota: f.quota
            });
          }
        });
      }
    }
    
    // 写入KV
    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
      console.log('[LOG] KV 存储成功');
    }
    
    // 发送飞书通知
    await sendQuotaUpdateAlert(env, fundsData.funds.length, changes);
    console.log('[LOG] 数据同步任务完成');
  } catch (error) {
    console.error('[ERROR] 数据同步任务失败:', error.message);
  }
}

async function sendQuotaUpdateAlert(env, totalCount, changes) {
  if (!env.FEISHU_WEBHOOK) return;
  const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let msg = `📊 申购状态更新完成 (${t})\n\n`;
  msg += `总计获取: ${totalCount} 只基金\n`;
  msg += `状态变化: ${changes.length} 只基金\n`;
  if (changes.length > 0) {
    msg += '\n📋 变化列表:\n';
    changes.forEach(({ code, name, oldQuota, newQuota }) => {
      msg += `• ${code} ${name}: ${oldQuota} → ${newQuota}\n`;
    });
  }
  await fetch(env.FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
  });
}


// ==================== 溢价监控 ====================
const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const m = now.getUTCMinutes();
    const day = now.getUTCDay();
    
    // 转换为北京时间
    const h = (hour + 8) % 24;
    const d = (hour + 8 >= 24) ? (day + 1) % 7 : day;

    console.log(`[LOG] smartMonitor - 北京时间: ${h}:${m}, 星期: ${d}`);

    const isTrading = isTestMode || (
      (d >= 1 && d <= 5) && (
        (h === 9 && m >= 25) ||
        (h === 10) ||
        (h === 11 && m <= 30) ||
        (h === 13 && m >= 0) ||
        (h === 14) ||
        (h === 15 && m <= 0)
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
      (h === 9 && m === 25) ||
      (h === 10 && (m === 0 || m === 30)) ||
      (h === 11 && (m === 0 || m === 30)) ||
      (h === 13 && m === 0) ||
      (h === 13 && m === 30) ||
      (h === 14 && m === 0) ||
      (h === 14 && m === 30)
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
      const threshold = fund.premiumThreshold || 3;

      if (isTestMode || Math.abs(premium) >= threshold) {
        allAbnormalFunds.push({ fund, premiumRate: premium });
        if (!isTestMode) {
          const alert = checkDynamicChange(fund.code, premium);
          if (alert) alerts.push(alert);
        }
      }
    }

    console.log(`[LOG] 异常基金数量: ${allAbnormalFunds.length}`);

    if (isGlobalAlert && allAbnormalFunds.length > 0) {
      console.log('[LOG] 发送全局提醒');
      await sendGlobalAlert(env, allAbnormalFunds);
    }
    if (!isGlobalAlert && alerts.length > 0) {
      console.log('[LOG] 发送动态提醒');
      await sendDynamicAlerts(env, alerts, fundsData);
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

  if (Math.abs(change) >= 1.5 && Math.abs(premium) >= 3 && (now - (LAST_ALERT_TIME[code] || 0) > 10 * 60 * 1000)) {
    LAST_ALERT_TIME[code] = now;
    return { fundCode: code, premium, change, type: change > 0 ? '溢价上升' : '折价加深' };
  }
  return null;
}

async function loadFundsData(env) {
  // 优先从GitHub拉取最新数据，然后更新KV
  try {
    const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
    const data = await res.json();
    // 更新KV
    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(data, null, 2));
    }
    return data;
  } catch (e) {
    console.error('[ERROR] 从GitHub拉取数据失败，回退到KV:', e.message);
    // 回退到KV
    if (env.FUNDS_KV) {
      const d = await env.FUNDS_KV.get('funds');
      if (d) return JSON.parse(d);
    }
    throw e;
  }
}

async function fetchMarketData(fundsData) {
  const fundTqs = fundsData.funds.map(f => f.tq);
  const idxTqs = [...new Set(fundsData.funds.flatMap(f =>
    Array.isArray(f.benchmark) ? f.benchmark.map(b => b.tq) :
    f.benchmark?.tq ? [f.benchmark.tq] : f.benchmark ? [f.benchmark] : []
  ))];
  const all = [...new Set([...fundTqs, ...idxTqs])].join(',');
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
  return { fundMarketData, indexData };
}

async function sendGlobalAlert(env, funds) {
  if (!env.FEISHU_WEBHOOK) return;
  const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let msg = `检测时间: ${t}\n\n`;
  funds.forEach(({ fund, premiumRate }) => {
    const p = premiumRate >= 0 ? `+${premiumRate.toFixed(2)}%` : `${premiumRate.toFixed(2)}%`;
    msg += `• ${fund.code} ${fund.name}: ${p} (${fund.quota || '未知'})\n`;
  });
  await fetch(env.FEISHU_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_type: 'text', content: { text: msg } }) });
}

async function sendDynamicAlerts(env, alerts, fundsData) {
  if (!env.FEISHU_WEBHOOK) return;
  const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let msg = `检测时间: ${t}\n\n`;
  alerts.forEach(a => {
    const f = fundsData.funds.find(x => x.code === a.fundCode);
    msg += `• ${a.fundCode} ${f?.name || a.fundCode}: ${a.type}\n  当前: ${a.premium.toFixed(2)}%  变化: ${a.change.toFixed(2)}%  ${f?.quota || '未知'}\n`;
  });
  await fetch(env.FEISHU_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_type: 'text', content: { text: msg } }) });
}
