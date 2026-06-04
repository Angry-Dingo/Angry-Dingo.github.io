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

    // 精确匹配专用同步cron，避免与 */5 监控cron同时触发导致重复推送
    // 同步cron: 0 23 * * 0-4 (UTC 23:00 = 北京 7:00) / 0 12 * * 1-5 (UTC 12:00 = 北京 20:00)
    if (cron === '0 23 * * 0-4' || cron === '0 12 * * 1-5') {
      console.log('[LOG] 执行数据同步任务');
      ctx.waitUntil(syncDataFromGitHub(env));
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
    return new Response('LOF 基金监控服务', { status: 200 });
  }
};

function quotaIcon(quota) {
  if (!quota) return '⚪';
  if (quota === '暂停') return '🔴';
  if (quota === '开放') return '🟢';
  return '🟠';
}

// ==================== 数据同步任务 ====================
async function syncDataFromGitHub(env) {
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

    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
      console.log('[LOG] KV 存储成功');
    }

    await sendQuotaUpdateAlert(env, fundsData.funds.length, changes);
    console.log('[LOG] 数据同步任务完成');
  } catch (error) {
    console.error('[ERROR] 数据同步任务失败:', error.message);
  }
}

async function sendQuotaUpdateAlert(env, totalCount, changes) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 未配置飞书Webhook，跳过发送');
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

// ==================== 溢价监控 ====================
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
      const threshold = fund.premiumThreshold || 2;

      if (isTestMode || Math.abs(premium) >= threshold) {
        allAbnormalFunds.push({ fund, premiumRate: premium });
        if (!isTestMode) {
          const alert = checkDynamicChange(fund.code, premium);
          if (alert) alerts.push(alert);
        }
      }
    }

    console.log(`[LOG] 异常基金数量: ${allAbnormalFunds.length}`);

    if (allAbnormalFunds.length > 0) {
      console.log('[LOG] 异常基金详情:');
      allAbnormalFunds.forEach(({ fund, premiumRate }) => {
        console.log(`[LOG]   ${fund.code} ${fund.name}: ${premiumRate.toFixed(2)}%`);
      });
    } else {
      console.log('[LOG] 没有异常基金，不会发送提醒');
    }

    if (isGlobalAlert) {
      if (allAbnormalFunds.length > 0) {
        console.log('[LOG] 发送全局提醒');
        await sendGlobalAlert(env, allAbnormalFunds);
      } else {
        console.log('[LOG] 全局提醒时间但无异常基金，不发送');
      }
    } else {
      if (alerts.length > 0) {
        console.log('[LOG] 发送动态提醒');
        await sendDynamicAlerts(env, alerts, fundsData);
      } else {
        console.log('[LOG] 动态提醒时间但无符合条件的基金，不发送');
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

  if (Math.abs(change) >= 1 && Math.abs(premium) >= 2 && (now - (LAST_ALERT_TIME[code] || 0) > 10 * 60 * 1000)) {
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

  // 补充东方财富数据源（腾讯qt不支持的指数：中证自定义指数、债券指数等）
  const EM_CODES = [
    ['csi930917', '2.930917'],
    ['csi930914', '2.930914'],
    ['csi930792', '2.930792'],
    ['sh000985',  '1.000985'],
    ['sh000066',  '1.000066'],
    ['sh000945',  '1.000945'],
  ];
  await Promise.all(EM_CODES.map(async ([tq, secid]) => {
    try {
      const r = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f170&_=${Date.now()}`);
      const d = await r.json();
      if (d.data && d.data.f43 > 0 && d.data.f170 !== undefined) {
        indexData[tq] = d.data.f170 / 100;
      }
    } catch (e) {}
  }));

  // 指数降级：腾讯或东方财富查不到的指数，用相近指数替代
  if (indexData['hkHSMI'] == null || indexData['hkHSMI'] === 0) {
    if (indexData['hkHSI'] != null) indexData['hkHSMI'] = indexData['hkHSI'];
  }
  if (indexData['hkHSCI'] == null || indexData['hkHSCI'] === 0) {
    if (indexData['hkHSI'] != null) indexData['hkHSCI'] = indexData['hkHSI'];
  }

  return { fundMarketData, indexData };
}

async function sendGlobalAlert(env, funds) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 未配置飞书Webhook，跳过发送');
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });

    if (response.ok) {
      await env.FUNDS_KV?.put(lockKey, '1', { expirationTtl: 120 });
      console.log('[LOG] 全局溢价提醒已发送');
    } else {
      console.error('[ERROR] 飞书通知发送失败:', response.status);
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });

    if (response.ok) {
      await env.FUNDS_KV?.put(lockKey, '1', { expirationTtl: 120 });
      console.log('[LOG] 动态溢价提醒已发送');
    } else {
      console.error('[ERROR] 飞书通知发送失败:', response.status);
    }
  } catch (error) {
    console.error('[ERROR] 发送动态溢价提醒失败:', error.message);
  }
}
