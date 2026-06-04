export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day = now.getUTCDay();
    const cron = event.cron;

    const beijingHour = (hour + 8) % 24;
    const beijingDay = (hour + 8 >= 24) ? (day + 1) % 7 : day;

    console.log(`[LOG] UTC: ${hour}:${minute}, 鏄熸湡: ${day}, 鍖椾含: ${beijingHour}:${minute}, 鏄熸湡: ${beijingDay}, Cron: ${cron}`);

    const isWeekday = (beijingDay >= 1 && beijingDay <= 5);
    const isSyncTime = isWeekday && (
      (beijingHour === 7 && minute === 0) ||
      (beijingHour === 20 && minute === 0)
    );

    if (isSyncTime) {
      console.log('[LOG] 鎵ц鏁版嵁鍚屾浠诲姟');
      ctx.waitUntil(syncDataFromGitHub(env));
    } else {
      console.log('[LOG] 鎵ц婧环鐩戞帶浠诲姟');
      ctx.waitUntil(smartMonitor(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/test') {
      ctx.waitUntil(smartMonitor(env, true));
      return new Response('娴嬭瘯宸茶Е鍙?, { status: 200 });
    }
    if (url.pathname === '/sync') {
      ctx.waitUntil(syncDataFromGitHub(env));
      return new Response('鏁版嵁鍚屾宸茶Е鍙?, { status: 200 });
    }
    return new Response('LOF 鍩洪噾鐩戞帶鏈嶅姟', { status: 200 });
  }
};

function quotaIcon(quota) {
  if (!quota) return '鈿?;
  if (quota === '鏆傚仠') return '馃敶';
  if (quota === '寮€鏀?) return '馃煝';
  return '馃煚';
}

// ==================== 鏁版嵁鍚屾浠诲姟 ====================
async function syncDataFromGitHub(env) {
  try {
    console.log('[LOG] === 寮€濮嬫暟鎹悓姝ヤ换鍔?===');

    const res = await fetch('https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json');
    const fundsData = await res.json();
    console.log(`[LOG] 浠嶨itHub鍔犺浇 ${fundsData.funds.length} 鍙熀閲慲);

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
              oldQuota: oldQuotaMap[f.code] || '鏈煡',
              newQuota: f.quota
            });
          }
        });
      }
    }

    if (env.FUNDS_KV) {
      await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
      console.log('[LOG] KV 瀛樺偍鎴愬姛');
    }

    await sendQuotaUpdateAlert(env, fundsData.funds.length, changes);
    console.log('[LOG] 鏁版嵁鍚屾浠诲姟瀹屾垚');
  } catch (error) {
    console.error('[ERROR] 鏁版嵁鍚屾浠诲姟澶辫触:', error.message);
  }
}

async function sendQuotaUpdateAlert(env, totalCount, changes) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 鏈厤缃涔ebhook锛岃烦杩囧彂閫?);
    return;
  }

  const now = Date.now();

  const lastSendTime = await env.FUNDS_KV?.get('lastQuotaAlertTime');
  if (lastSendTime && now - parseInt(lastSendTime) < 5 * 60 * 1000) {
    console.log('[LOG] 5鍒嗛挓鍐呭凡鍙戦€佽繃鐢宠喘鐘舵€佹洿鏂伴€氱煡锛岃烦杩?);
    return;
  }

  try {
    const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let msg = `馃搳 鐢宠喘鐘舵€佹洿鏂板畬鎴?(${t})\n\n`;
    msg += `鎬昏鑾峰彇: ${totalCount} 鍙熀閲慭n`;
    msg += `鐘舵€佸彉鍖? ${changes.length} 鍙熀閲慭n`;
    if (changes.length > 0) {
      msg += '\n馃搵 鍙樺寲鍒楄〃:\n';
      changes.forEach(({ code, name, oldQuota, newQuota }) => {
        const oldIcon = quotaIcon(oldQuota);
        const newIcon = quotaIcon(newQuota);
        msg += `鈥?${code} ${name}: ${oldIcon}${oldQuota} 鈫?${newIcon}${newQuota}\n`;
      });
    }

    const response = await fetch(env.FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });

    if (response.ok) {
      await env.FUNDS_KV?.put('lastQuotaAlertTime', now.toString());
      console.log('[LOG] 鐢宠喘鐘舵€佹洿鏂伴€氱煡宸插彂閫?);
    } else {
      console.error('[ERROR] 椋炰功閫氱煡鍙戦€佸け璐?', response.status);
    }

  } catch (error) {
    console.error('[ERROR] 鍙戦€佺敵璐姸鎬侀€氱煡澶辫触:', error.message);
  }
}

// ==================== 婧环鐩戞帶 ====================
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

    console.log(`[LOG] smartMonitor - 鍖椾含鏃堕棿: ${h}:${m}, 鏄熸湡: ${d}`);

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
      console.log('[LOG] 涓嶅湪浜ゆ槗鏃堕棿锛岃烦杩?);
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

    console.log(`[LOG] 寮傚父鍩洪噾鏁伴噺: ${allAbnormalFunds.length}`);

    if (allAbnormalFunds.length > 0) {
      console.log('[LOG] 寮傚父鍩洪噾璇︽儏:');
      allAbnormalFunds.forEach(({ fund, premiumRate }) => {
        console.log(`[LOG]   ${fund.code} ${fund.name}: ${premiumRate.toFixed(2)}%`);
      });
    } else {
      console.log('[LOG] 娌℃湁寮傚父鍩洪噾锛屼笉浼氬彂閫佹彁閱?);
    }

    if (isGlobalAlert) {
      if (allAbnormalFunds.length > 0) {
        console.log('[LOG] 鍙戦€佸叏灞€鎻愰啋');
        await sendGlobalAlert(env, allAbnormalFunds);
      } else {
        console.log('[LOG] 鍏ㄥ眬鎻愰啋鏃堕棿浣嗘棤寮傚父鍩洪噾锛屼笉鍙戦€?);
      }
    } else {
      if (alerts.length > 0) {
        console.log('[LOG] 鍙戦€佸姩鎬佹彁閱?);
        await sendDynamicAlerts(env, alerts, fundsData);
      } else {
        console.log('[LOG] 鍔ㄦ€佹彁閱掓椂闂翠絾鏃犵鍚堟潯浠剁殑鍩洪噾锛屼笉鍙戦€?);
      }
    }
  } catch (e) {
    console.error('[ERROR] 鐩戞帶澶辫触:', e);
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
    return { fundCode: code, premium, change, type: change > 0 ? '婧环涓婂崌' : '鎶樹环鍔犳繁' };
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
    console.error('[ERROR] 浠嶨itHub鎷夊彇鏁版嵁澶辫触锛屽洖閫€鍒癒V:', e.message);
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

  // 琛ュ厖涓滄柟璐㈠瘜鏁版嵁婧愶紙鑵捐qt涓嶆敮鎸佺殑鎸囨暟锛氫腑璇佽嚜瀹氫箟鎸囨暟銆佸€哄埜鎸囨暟绛夛級
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

  return { fundMarketData, indexData };
}

async function sendGlobalAlert(env, funds) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 鏈厤缃涔ebhook锛岃烦杩囧彂閫?);
    return;
  }

  const now = new Date();
  const timeKey = `${now.getHours()}:${now.getMinutes()}`;
  const lockKey = `globalAlertLock_${timeKey}`;

  try {
    const existingLock = await env.FUNDS_KV?.get(lockKey);
    if (existingLock) {
      console.log('[LOG] 鐩稿悓鏃堕棿宸插彂閫佽繃鍏ㄥ眬鎻愰啋锛岃烦杩?);
      return;
    }

    const sorted = [...funds].sort((a, b) => b.premiumRate - a.premiumRate);

    const t = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let msg = `馃搱 婧环鎻愰啋 - 鍏ㄥ眬姹囨€籠n妫€娴嬫椂闂? ${t}\n\n`;
    sorted.forEach(({ fund, premiumRate }) => {
      const p = premiumRate >= 0 ? `+${premiumRate.toFixed(2)}%` : `${premiumRate.toFixed(2)}%`;
      const icon = quotaIcon(fund.quota);
      msg += `鈥?${fund.code} ${fund.name}: ${p}  ${icon}${fund.quota || '鏈煡'}\n`;
    });

    const response = await fetch(env.FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });

    if (response.ok) {
      await env.FUNDS_KV?.put(lockKey, '1', { expirationTtl: 120 });
      console.log('[LOG] 鍏ㄥ眬婧环鎻愰啋宸插彂閫?);
    } else {
      console.error('[ERROR] 椋炰功閫氱煡鍙戦€佸け璐?', response.status);
    }
  } catch (error) {
    console.error('[ERROR] 鍙戦€佸叏灞€婧环鎻愰啋澶辫触:', error.message);
  }
}

async function sendDynamicAlerts(env, alerts, fundsData) {
  if (!env.FEISHU_WEBHOOK) {
    console.log('[LOG] 鏈厤缃涔ebhook锛岃烦杩囧彂閫?);
    return;
  }

  const lockKey = 'dynamicAlertLock';

  try {
    const existingLock = await env.FUNDS_KV?.get(lockKey);
    if (existingLock) {
      console.log('[LOG] 2鍒嗛挓鍐呭凡鍙戦€佽繃鍔ㄦ€佹彁閱掞紝璺宠繃');
      return;
    }

    const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let msg = `馃搳 婧环鎻愰啋 - 鍔ㄦ€佸彉鍖朶n妫€娴嬫椂闂? ${t}\n\n`;
    alerts.forEach(a => {
      const f = fundsData.funds.find(x => x.code === a.fundCode);
      const icon = quotaIcon(f?.quota);
      msg += `鈥?${a.fundCode} ${f?.name || a.fundCode}: ${a.type}\n  褰撳墠: ${a.premium.toFixed(2)}%  鍙樺寲: ${a.change.toFixed(2)}%  ${icon}${f?.quota || '鏈煡'}\n`;
    });

    const response = await fetch(env.FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
    });

    if (response.ok) {
      await env.FUNDS_KV?.put(lockKey, '1', { expirationTtl: 120 });
      console.log('[LOG] 鍔ㄦ€佹孩浠锋彁閱掑凡鍙戦€?);
    } else {
      console.error('[ERROR] 椋炰功閫氱煡鍙戦€佸け璐?', response.status);
    }
  } catch (error) {
    console.error('[ERROR] 鍙戦€佸姩鎬佹孩浠锋彁閱掑け璐?', error.message);
  }
}
