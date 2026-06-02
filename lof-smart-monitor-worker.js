export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const hour = beijingTime.getUTCHours();
    const minute = beijingTime.getUTCMinutes();
    const day = beijingTime.getUTCDay();
    const cron = event.cron;

    console.log(`[LOG] 北京时间: ${hour}:${minute}, 星期: ${day}, Cron: ${cron}`);

    // ✅ 完全由Cron控制任务执行
    // 通过环境变量配置数据更新任务的Cron表达式（逗号分隔）
    // 例如: UPDATE_CRON="0 23 * * SUN-THU,5 5 * * MON-FRI"
    const updateCrons = env.UPDATE_CRON ? env.UPDATE_CRON.split(',').map(s => s.trim()) : [];
    
    if (updateCrons.includes(cron)) {
      console.log('[LOG] 执行数据更新任务（Cron触发）');
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
    if (url.pathname === '/update') {
      ctx.waitUntil(updateDataTask(env));
      return new Response('数据更新已触发', { status: 200 });
    }
    return new Response('LOF 基金监控服务', { status: 200 });
  }
};

// ==================== 数据更新任务 ====================
async function updateDataTask(env) {
  try {
    console.log('[LOG] === 开始数据更新任务 ===');

    const fundsData = await loadFundsData(env);
    console.log(`[LOG] 加载 ${fundsData.funds.length} 只基金`);

    const BATCH_SIZE = 10;
    const navData = {};
    const quotaData = {};

    for (let i = 0; i < fundsData.funds.length; i += BATCH_SIZE) {
      const batch = fundsData.funds.slice(i, i + BATCH_SIZE);
      console.log(`[LOG] 处理第 ${Math.floor(i/BATCH_SIZE) + 1} 批`);

      const navResults = await Promise.all(batch.map(f => fetchSingleNav(f.code)));
      const quotaResults = await Promise.all(batch.map(f => fetchSingleQuota(f.code)));

      navResults.forEach((r, idx) => { if (r) navData[batch[idx].code] = r; });
      quotaResults.forEach((r, idx) => { if (r) quotaData[batch[idx].code] = r; });

      await sleep(500);
    }

    const quotaChanges = [];
    const originalQuota = {};
    fundsData.funds.forEach(fund => {
      originalQuota[fund.code] = fund.quota;
    });

    for (const fund of fundsData.funds) {
      const navInfo = navData[fund.code];
      if (navInfo && navInfo.nav > 0) {
        fund.officialNav = navInfo.nav;
        fund.navDate = navInfo.date;
      }

      const quotaInfo = quotaData[fund.code];
      if (quotaInfo) {
        let newQuota = null;
        if (quotaInfo.limit === 0) newQuota = '暂停';
        else if (quotaInfo.limit === null) newQuota = '开放';
        else if (quotaInfo.limit === -1) newQuota = '限大额';
        else if (quotaInfo.limit > 0) {
          if (quotaInfo.limit >= 10000) {
            const wan = quotaInfo.limit / 10000;
            newQuota = `限额${wan % 1 === 0 ? wan.toFixed(0) : wan.toFixed(2)}万`;
          } else {
            newQuota = `限额${quotaInfo.limit.toFixed(0)}元`;
          }
        }

        if (newQuota !== null && newQuota !== originalQuota[fund.code]) {
          quotaChanges.push({
            code: fund.code,
            name: fund.name,
            oldQuota: originalQuota[fund.code] || '未知',
            newQuota: newQuota
          });
        }
        fund.quota = newQuota;
      }
    }

    fundsData.updatedAt = new Date().toISOString();

    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
      console.log('[LOG] KV 存储成功');
    }

    await sendQuotaUpdateAlert(env, Object.keys(quotaData).length, quotaChanges);
    console.log('[LOG] 数据更新任务完成');
  } catch (error) {
    console.error('[ERROR] 数据更新任务失败:', error.message);
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

async function fetchSingleNav(code) {
  try {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const res = await fetch(url);
    const text = await res.text();
    const match = text.match(/jsonpgz\(([^)]+)\)/);
    if (match) {
      const data = JSON.parse(match[1]);
      const dwjz = data.DWJZ || data.dwjz;
      if (dwjz > 0) return { nav: parseFloat(dwjz), date: data.FSRQ || data.fsrq };
    }
    return null;
  } catch (e) { return null; }
}

async function fetchSingleQuota(code) {
  try {
    const res = await fetch(`https://fund.eastmoney.com/${code}.html`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'http://fund.eastmoney.com/' }
    });
    const html = await res.text();
    let result = null;
    let m = html.match(/单日累计购买上限\s*([\d,.]+)\s*元(?!万)/);
    if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')), unit: '元' };
    if (!result) {
      m = html.match(/单日累计购买上限\s*([\d,.]+)\s*万元/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
    }
    if (!result && html.match(/限大额|大额限购/)) result = { limit: -1, status: '限大额' };
    if (!result && html.match(/暂停申购/)) result = { limit: 0 };
    if (!result && html.match(/开放申购/)) result = { limit: null };
    return result;
  } catch (e) { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==================== 溢价监控 ====================
const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const h = beijingTime.getUTCHours();
    const m = beijingTime.getUTCMinutes();
    const d = beijingTime.getUTCDay();

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
  if (env.FUNDS_KV) {
    const d = await env.FUNDS_KV.get('funds');
    if (d) return JSON.parse(d);
  }
  const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
  return await res.json();
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
