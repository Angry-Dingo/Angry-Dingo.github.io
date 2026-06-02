export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    // ✅ 直接用UTC时间计算北京时间
    // UTC小时 +8 = 北京时间小时，超过24则减24
    let hour = now.getUTCHours() + 8;
    if (hour >= 24) hour -= 24;
    const minute = now.getUTCMinutes();
    let day = now.getUTCDay();
    // 如果UTC小时+8超过了24，说明是北京时间的第二天
    if (now.getUTCHours() + 8 >= 24) {
      day = (day + 1) % 7;
    }
    
    let needUpdateData = false;
    if (env.FUNDS_KV) {
      try {
        const existingData = await env.FUNDS_KV.get('funds');
        if (!existingData) {
          needUpdateData = true;
        } else {
          const data = JSON.parse(existingData);
          const lastUpdated = new Date(data.updatedAt || 0);
          const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);
          if (hoursSinceUpdate > 12) needUpdateData = true;
        }
      } catch (e) {
        needUpdateData = true;
      }
    }
    
    // ✅ 北京时间8:00和13:10，周一到周五
    if ((((hour === 8 && minute === 0) || (hour === 13 && minute === 10)) && day >= 1 && day <= 5) || needUpdateData) {
      console.log('开始执行数据更新任务');
      ctx.waitUntil(updateDataTask(env));
      return;
    }
    
    ctx.waitUntil(smartMonitor(env));
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
    console.log('=== 开始数据更新任务 ===');
    
    const fundsData = await loadFundsData(env);
    console.log(`加载 ${fundsData.funds.length} 只基金`);
    
    // ✅ 分批处理：每次只处理 10 只基金
    const BATCH_SIZE = 10;
    const navData = {};
    const quotaData = {};
    
    for (let i = 0; i < fundsData.funds.length; i += BATCH_SIZE) {
      const batch = fundsData.funds.slice(i, i + BATCH_SIZE);
      console.log(`处理第 ${Math.floor(i/BATCH_SIZE) + 1} 批 (${batch.length} 只)`);
      
      // 净值和申购状态并行获取
      const navResults = await Promise.all(batch.map(f => fetchSingleNav(f.code)));
      const quotaResults = await Promise.all(batch.map(f => fetchSingleQuota(f.code)));
      
      navResults.forEach((r, idx) => { if (r) navData[batch[idx].code] = r; });
      quotaResults.forEach((r, idx) => { if (r) quotaData[batch[idx].code] = r; });
      
      await sleep(500);
    }
    
    console.log(`获取到 ${Object.keys(navData).length} 只基金的净值`);
    console.log(`获取到 ${Object.keys(quotaData).length} 只基金的申购状态`);
    
    // 记录申购状态变化
    const quotaChanges = [];
    const originalQuota = {};
    fundsData.funds.forEach(fund => {
      originalQuota[fund.code] = fund.quota;
    });
    
    let updatedCount = 0;
    for (const fund of fundsData.funds) {
      const navInfo = navData[fund.code];
      if (navInfo && navInfo.nav > 0) {
        fund.officialNav = navInfo.nav;
        fund.navDate = navInfo.date;
        updatedCount++;
      }
      
      const quotaInfo = quotaData[fund.code];
      if (quotaInfo) {
        let newQuota = null;
        if (quotaInfo.limit === 0) {
          newQuota = '暂停';
        } else if (quotaInfo.limit === null) {
          newQuota = '开放';
        } else if (quotaInfo.limit === -1) {
          newQuota = '限大额';
        } else if (quotaInfo.limit > 0) {
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
    console.log(`更新了 ${updatedCount} 只基金的净值`);
    console.log(`申购状态变化: ${quotaChanges.length} 只基金`);
    
    if (env.FUNDS_KV) {
      try {
        await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
        console.log('KV 存储成功');
      } catch (e) {
        console.error('KV 存储失败:', e);
      }
    }
    
    if (env.GITHUB_TOKEN) {
      try {
        await pushToGitHub(env, fundsData);
        console.log('GitHub 推送成功');
      } catch (e) {
        console.error('GitHub 推送失败:', e);
      }
    }
    
    // 发送申购状态变化通知
    await sendQuotaUpdateAlert(env, Object.keys(quotaData).length, quotaChanges);
  } catch (error) {
    console.error('数据更新任务失败:', error.message);
    await sendFeishuAlert(env, `❌ 数据更新失败: ${error.message}`);
  }
}

// 发送申购状态更新通知
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

// ✅ 单次请求，不重试
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
  } catch (e) {
    return null;
  }
}

async function fetchSingleQuota(code) {
  try {
    const res = await fetch(`https://fund.eastmoney.com/${code}.html`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'http://fund.eastmoney.com/'
      }
    });
    const html = await res.text();
    
    let result = null;
    
    // 1. 优先匹配"单日累计购买上限"格式（东方财富最常见）
    let m = html.match(/单日累计购买上限\s*([\d,.]+)\s*元(?!万)/);
    if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')), unit: '元' };
    
    if (!result) {
      m = html.match(/单日累计购买上限\s*([\d,.]+)\s*万元/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
    }
    
    // 2. 匹配"单日限购"格式
    if (!result) {
      m = html.match(/单日限购\s*([\d,.]+)\s*元(?!万)/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')), unit: '元' };
    }
    if (!result) {
      m = html.match(/单日限购\s*([\d,.]+)\s*万元/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
    }
    
    // 3. 匹配"申购限额"格式
    if (!result) {
      m = html.match(/申购限额[：:]\s*([\d,.]+)\s*万元?/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
    }
    
    // 4. 匹配"限购"格式
    if (!result) {
      m = html.match(/限购\s*([\d,.]+)\s*元(?!万)/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')), unit: '元' };
    }
    if (!result) {
      m = html.match(/限购\s*([\d,.]+)\s*万元/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
    }
    
    // 5. 判断交易状态
    if (!result && html.match(/限大额|大额限购|限额申购/)) {
      m = html.match(/上限\s*([\d,.]+)\s*元(?!万)/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')), unit: '元' };
      if (!result) {
        m = html.match(/上限\s*([\d,.]+)\s*万元/);
        if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
      }
      if (!result) result = { limit: -1, status: '限大额' };
    }
    
    if (!result && html.match(/暂停申购|暂停大额申购|暂停大额/)) result = { limit: 0 };
    if (!result && html.match(/开放申购|正常申购/)) result = { limit: null };
    
    if (result) {
      console.log(`[${code}] 申购状态:`, JSON.stringify(result));
    } else {
      console.log(`[${code}] 未识别申购状态`);
    }
    
    return result;
  } catch (e) {
    console.error(`[${code}] 申购状态抓取异常:`, e.message);
    return null;
  }
}

async function pushToGitHub(env, fundsData) {
  const content = JSON.stringify(fundsData, null, 2);
  const contentBase64 = btoa(unescape(encodeURIComponent(content)));
  
  const getRes = await fetch(`https://api.github.com/repos/Angry-Dingo/Angry-Dingo.github.io/contents/data/funds.json?ref=main`, {
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}` }
  });
  let sha = null;
  if (getRes.ok) sha = (await getRes.json()).sha;
  
  const putRes = await fetch(`https://api.github.com/repos/Angry-Dingo/Angry-Dingo.github.io/contents/data/funds.json`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update funds ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      content: contentBase64,
      branch: 'main',
      sha: sha
    })
  });
  if (!putRes.ok) throw new Error((await putRes.json()).message);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==================== 溢价监控 ====================
const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

function isTradingHour(h, m) {
  return (h === 9 && m >= 25) || (h === 10) || (h === 11 && m <= 30) || (h >= 13 && h < 15);
}

function isGlobalAlertTime(h, m) {
  return (h === 9 && m === 25) || (h === 10 && (m === 0 || m === 30)) || (h === 11 && (m === 0 || m === 30)) || (h >= 13 && h < 15 && m === 0) || (h >= 13 && h < 15 && m === 30);
}

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    // ✅ 直接用UTC时间计算北京时间
    // UTC小时 +8 = 北京时间小时，超过24则减24
    let h = now.getUTCHours() + 8;
    if (h >= 24) h -= 24;
    const m = now.getUTCMinutes();
    let d = now.getUTCDay();
    // 如果UTC小时+8超过了24，说明是北京时间的第二天
    if (now.getUTCHours() + 8 >= 24) {
      d = (d + 1) % 7;
    }
    
    if (!isTestMode && (d === 0 || d === 6 || !isTradingHour(h, m))) return;
    
    const fundsData = await loadFundsData(env);
    const { fundMarketData, indexData } = await fetchMarketData(fundsData);
    
    const alerts = [];
    const allAbnormalFunds = [];
    const isGlobalAlert = isTestMode || isGlobalAlertTime(h, m);
    
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
    
    if (isGlobalAlert && allAbnormalFunds.length > 0) {
      await sendGlobalAlert(env, allAbnormalFunds);
    }
    if (!isGlobalAlert && alerts.length > 0) {
      await sendDynamicAlerts(env, alerts, fundsData);
    }
  } catch (e) {
    console.error('监控失败:', e);
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

async function sendFeishuAlert(env, msg) {
  if (!env.FEISHU_WEBHOOK) return;
  await fetch(env.FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text: `${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n${msg}` } })
  });
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
