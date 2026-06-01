export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // 处理 HTTP 请求
  if (url.pathname === '/test') {
    console.log('触发测试');
    context.waitUntil(smartMonitor(env, true));
    return new Response('测试已触发，请查看飞书', {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  }
  
  if (url.pathname === '/update') {
    console.log('手动触发数据更新');
    context.waitUntil(updateDataTask(env));
    return new Response('数据更新已触发', {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  }
  
  // 对于其他路径，继续到静态资源
  return env.ASSETS.fetch(request);
}

export async function onScheduled(context) {
  const { env } = context;
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const hour = beijingTime.getUTCHours();
  const minute = beijingTime.getUTCMinutes();
  const day = beijingTime.getUTCDay();
  
  // 每天早上 7:00（北京时间，UTC 23:00）更新净值和申购状态
  if (hour === 23 && minute === 0 && day >= 1 && day <= 5) {
    console.log('开始执行数据更新任务（净值 + 申购状态）');
    context.waitUntil(updateDataTask(env));
    return;
  }
  
  // 交易时间执行溢价监控
  console.log('开始执行 LOF 基金智能监控任务');
  context.waitUntil(smartMonitor(env));
}

// ==================== 数据更新任务 ====================

async function updateDataTask(env) {
  try {
    console.log('=== 开始数据更新任务 ===');
    
    // 1. 从 GitHub 加载现有数据
    const fundsData = await loadFundsData(env);
    console.log(`加载 ${fundsData.funds.length} 只基金`);
    
    // 2. 更新净值
    console.log('开始获取净值数据...');
    const navData = await fetchNavData(fundsData.funds);
    console.log(`获取到 ${Object.keys(navData).length} 只基金的净值`);
    
    // 3. 更新申购状态
    console.log('开始获取申购状态...');
    const quotaData = await fetchQuotaData(fundsData.funds);
    console.log(`获取到 ${Object.keys(quotaData).length} 只基金的申购状态`);
    
    // 4. 合并数据
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
        if (quotaInfo.limit === 0) {
          fund.quota = '暂停';
        } else if (quotaInfo.limit === null) {
          fund.quota = '开放';
        } else if (quotaInfo.limit > 0) {
          fund.quota = `限额${quotaInfo.limit}`;
        }
      }
    }
    
    fundsData.updatedAt = new Date().toISOString();
    console.log(`更新了 ${updatedCount} 只基金的净值`);
    
    // 5. 保存到 KV
    if (env.FUNDS_KV) {
      console.log('保存数据到 KV...');
      await env.FUNDS_KV.put('funds', JSON.stringify(fundsData, null, 2));
      console.log('KV 存储成功');
    }
    
    // 6. 推送到 GitHub
    if (env.GITHUB_TOKEN) {
      console.log('推送数据到 GitHub...');
      await pushToGitHub(env, fundsData);
      console.log('GitHub 推送成功');
    }
    
    // 7. 发送通知
    await sendFeishuAlert(env, `数据更新完成：${updatedCount} 只基金净值已更新`);
    
    console.log('=== 数据更新任务完成 ===');
  } catch (error) {
    console.error('数据更新任务失败:', error);
    await sendFeishuAlert(env, `❌ 数据更新失败: ${error.message}`);
  }
}

// ==================== 获取净值 ====================

async function fetchNavData(funds) {
  const navData = {};
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    console.log(`净值批次 ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(funds.length/BATCH_SIZE)}`);
    
    const results = await Promise.all(
      batch.map(fund => fetchSingleNav(fund.code))
    );
    
    results.forEach((result, index) => {
      if (result) {
        navData[batch[index].code] = result;
      }
    });
    
    await sleep(1000);
  }
  
  return navData;
}

async function fetchSingleNav(code) {
  try {
    // 方法1：天天基金估值接口
    const url1 = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const response1 = await fetch(url1);
    const text1 = await response1.text();
    
    const match = text1.match(/jsonpgz\(([^)]+)\)/);
    if (match) {
      const data = JSON.parse(match[1]);
      if (data && data.DWJZ > 0) {
        return { nav: parseFloat(data.DWJZ), date: data.FSRQ };
      }
    }
    
    // 方法2：东方财富历史净值
    const url2 = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1&startDate=&endDate=`;
    const response2 = await fetch(url2, {
      headers: {
        'Referer': 'https://fund.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const data2 = await response2.json();
    
    if (data2.Data && data2.Data.LSJZList && data2.Data.LSJZList.length > 0) {
      const item = data2.Data.LSJZList[0];
      return { nav: parseFloat(item.DWJZ), date: item.FSRQ };
    }
    
    return null;
  } catch (error) {
    console.error(`获取 ${code} 净值失败:`, error.message);
    return null;
  }
}

// ==================== 获取申购状态 ====================

async function fetchQuotaData(funds) {
  const quotaData = {};
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    console.log(`申购状态批次 ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(funds.length/BATCH_SIZE)}`);
    
    const results = await Promise.all(
      batch.map(fund => fetchSingleQuota(fund.code))
    );
    
    results.forEach((result, index) => {
      if (result) {
        quotaData[batch[index].code] = result;
      }
    });
    
    await sleep(1500);
  }
  
  return quotaData;
}

async function fetchSingleQuota(code) {
  try {
    const url = `https://fund.eastmoney.com/${code}.html`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await response.text();
    
    // 暂停申购
    if (html.match(/暂停申购|暂停大额申购|暂停大额|大额暂停/)) {
      return { limit: 0, source: 'detail_page_suspend' };
    }
    
    // 申购限额
    let limitMatch = html.match(/申购限额[：:]\s*([\d.]+)\s*万元?/);
    if (limitMatch && parseFloat(limitMatch[1]) > 0) {
      return { limit: parseFloat(limitMatch[1]) * 10000, source: 'detail_page' };
    }
    
    limitMatch = html.match(/单笔限额\s*([\d.]+)\s*万元?/);
    if (limitMatch && parseFloat(limitMatch[1]) > 0) {
      return { limit: parseFloat(limitMatch[1]) * 10000, source: 'detail_page' };
    }
    
    limitMatch = html.match(/单日累计申购上限\s*([\d.]+)\s*万元?/);
    if (limitMatch && parseFloat(limitMatch[1]) > 0) {
      return { limit: parseFloat(limitMatch[1]) * 10000, source: 'detail_page' };
    }
    
    // 开放申购
    if (html.match(/开放申购/)) {
      return { limit: null, source: 'detail_page_open' };
    }
    
    return null;
  } catch (error) {
    console.error(`获取 ${code} 申购状态失败:`, error.message);
    return null;
  }
}

// ==================== GitHub API 推送 ====================

async function pushToGitHub(env, fundsData) {
  const owner = 'Angry-Dingo';
  const repo = 'Angry-Dingo.github.io';
  const path = 'data/funds.json';
  const branch = 'main';
  
  const content = JSON.stringify(fundsData, null, 2);
  const contentBase64 = btoa(unescape(encodeURIComponent(content)));
  
  // 获取当前文件 SHA
  const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const getResponse = await fetch(getUrl, {
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  let sha = null;
  if (getResponse.ok) {
    const getData = await getResponse.json();
    sha = getData.sha;
  }
  
  // 推送文件
  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const putResponse = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify({
      message: `Update funds data: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      content: contentBase64,
      branch: branch,
      sha: sha
    })
  });
  
  if (!putResponse.ok) {
    const error = await putResponse.json();
    throw new Error(`GitHub API 错误: ${error.message}`);
  }
}

// ==================== 工具函数 ====================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 原有溢价监控代码 ====================

const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

function isTradingHour(hour, minute) {
  const morningStart = hour === 9 && minute >= 25;
  const morningEnd = hour < 11 || (hour === 11 && minute <= 30);
  const afternoonStart = hour >= 13;
  const afternoonEnd = hour < 15 || (hour === 15 && minute === 0);
  
  return (morningStart && morningEnd) || (afternoonStart && afternoonEnd);
}

function isGlobalAlertTime(hour, minute) {
  return (
    (hour === 9 && minute >= 30 && minute <= 59) ||
    (hour === 10 && (minute === 0 || minute === 30)) ||
    (hour === 11 && (minute === 0 || minute === 30)) ||
    (hour === 13 && (minute === 0 || minute === 30)) ||
    (hour === 14 && (minute === 0 || minute === 30)) ||
    (hour === 15 && minute === 0)
  );
}

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const hour = beijingTime.getUTCHours();
    const minute = beijingTime.getUTCMinutes();
    const day = beijingTime.getUTCDay();
    
    console.log(`当前时间(UTC): ${now.toISOString()}, 北京时间: ${hour}:${minute}, 周${day}`);
    
    if (!isTestMode && (day === 0 || day === 6 || !isTradingHour(hour, minute))) {
      console.log('非交易时间，跳过');
      return;
    }
    
    const isGlobalAlert = isTestMode || isGlobalAlertTime(hour, minute);
    
    console.log('开始加载静态数据...');
    const fundsData = await loadFundsData(env);
    console.log(`加载基金数据: ${fundsData.funds.length} 只`);
    
    console.log('开始获取实时行情...');
    const { fundMarketData, indexData } = await fetchMarketData(fundsData);
    console.log(`获取行情: ${Object.keys(fundMarketData).length} 只基金, ${Object.keys(indexData).length} 个指数`);
    
    const alerts = [];
    const allAbnormalFunds = [];
    const allFundsForDebug = [];
    
    let processedCount = 0;
    let skippedCount = 0;
    
    console.log(`开始检查 ${fundsData.funds.length} 只基金`);

    for (const fund of fundsData.funds) {
      const marketInfo = fundMarketData[fund.tq];

      if (!marketInfo) {
        console.log(`跳过 ${fund.code}: 无市场价格`);
        skippedCount++;
        continue;
      }

      const fundWithData = { ...fund, ...marketInfo };

      let nav = null;
      let benchChgPct = 0;

      const baseNav = fund.officialNav || marketInfo.prevClose;
      
      if (fund.benchmark) {
        benchChgPct = calculateBenchChgPct(fund.benchmark, indexData);
      }

      if (baseNav > 0) {
        nav = baseNav * (1 + benchChgPct / 100);
        fundWithData.nav = nav;
        fundWithData.navChange = benchChgPct;
      }

      if (!nav) {
        console.log(`跳过 ${fund.code}: 无法计算净值 (baseNav=${baseNav})`);
        skippedCount++;
        continue;
      }

      const premiumRate = ((marketInfo.price - nav) / nav) * 100;
      const threshold = fund.premiumThreshold || 3;

      console.log(`${fund.code}: 价格=${marketInfo.price.toFixed(4)}, 净值=${nav.toFixed(4)}, 溢价率=${premiumRate.toFixed(2)}%`);

      allFundsForDebug.push({ fund: fundWithData, marketInfo, premiumRate });
      processedCount++;

      if (isTestMode) {
        allAbnormalFunds.push({ fund: fundWithData, marketInfo, premiumRate });
      } else if (Math.abs(premiumRate) >= threshold) {
        allAbnormalFunds.push({ fund: fundWithData, marketInfo, premiumRate });
        
        const dynamicAlert = checkDynamicChange(fund.code, premiumRate, marketInfo);
        if (dynamicAlert) {
          alerts.push(dynamicAlert);
        }
      }
    }
    
    console.log(`处理完成: 共处理${processedCount}只, 跳过${skippedCount}只`);
    console.log(`待发送基金数量: ${allAbnormalFunds.length}, 动态报警数量: ${alerts.length}`);

    if (isGlobalAlert) {
      if (isTestMode) {
        if (allAbnormalFunds.length > 0) {
          await sendTestAlert(env, allAbnormalFunds);
          console.log(`测试模式：${allAbnormalFunds.length} 只基金测试发送成功`);
        } else {
          await sendTestAlert(env, allFundsForDebug.slice(0, 5));
          console.log(`测试模式：没有异常基金，发送前5只用于调试`);
        }
      } else if (allAbnormalFunds.length > 0) {
        await sendGlobalAlert(env, allAbnormalFunds);
        console.log(`全局提醒：${allAbnormalFunds.length} 只异常基金`);
      }
    }
    
    if (!isGlobalAlert && alerts.length > 0) {
      await sendDynamicAlerts(env, alerts, fundsData);
      console.log(`动态提醒：${alerts.length} 条`);
    }
    
    console.log('监控任务完成');
  } catch (error) {
    console.error('监控任务失败:', error);
    try {
      await sendFeishuAlert(env, `监控任务失败: ${error.message}`);
    } catch (e) {
      console.error('发送错误通知失败:', e);
    }
  }
}

function calculateBenchChgPct(benchDef, indexData) {
  if (Array.isArray(benchDef)) {
    let totalW = 0;
    let weightedChg = 0;
    
    benchDef.forEach(b => {
      const chg = indexData[b.tq] || 0;
      weightedChg += chg * b.w;
      totalW += b.w;
    });
    
    return totalW > 0 ? weightedChg / totalW : 0;
  } else if (benchDef && typeof benchDef === 'object') {
    return indexData[benchDef.tq] || 0;
  } else if (benchDef) {
    return indexData[benchDef] || 0;
  }
  
  return 0;
}

function checkDynamicChange(fundCode, currentPremium, marketInfo) {
  const now = Date.now();
  
  if (!PREMIUM_HISTORY[fundCode]) {
    PREMIUM_HISTORY[fundCode] = [];
  }
  
  PREMIUM_HISTORY[fundCode].push({ time: now, premium: currentPremium });
  
  if (PREMIUM_HISTORY[fundCode].length > 10) {
    PREMIUM_HISTORY[fundCode].shift();
  }
  
  const history = PREMIUM_HISTORY[fundCode];
  
  if (history.length < 3) return null;
  
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  const recentHistory = history.filter(h => h.time > fiveMinutesAgo);
  
  if (recentHistory.length < 2) return null;
  
  const avgPremium = recentHistory.reduce((sum, h) => sum + h.premium, 0) / recentHistory.length;
  const premiumChange = currentPremium - avgPremium;
  
  const suddenChange = Math.abs(premiumChange) >= 1.5;
  const overThreshold = Math.abs(currentPremium) >= 3;
  
  const lastAlert = LAST_ALERT_TIME[fundCode] || 0;
  const cooldownPassed = now - lastAlert > 10 * 60 * 1000;
  
  if (suddenChange && overThreshold && cooldownPassed) {
    LAST_ALERT_TIME[fundCode] = now;
    
    return {
      fundCode,
      premium: currentPremium,
      change: premiumChange,
      marketInfo,
      type: premiumChange > 0 ? '溢价上升' : '折价加深',
      time: new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    };
  }
  
  return null;
}

async function loadFundsData(env) {
  // 优先从 KV 读取
  if (env.FUNDS_KV) {
    const kvData = await env.FUNDS_KV.get('funds');
    if (kvData) {
      console.log('从 KV 加载数据');
      return JSON.parse(kvData);
    }
  }
  
  // 回退到 GitHub
  const githubDataUrl = 'https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json';
  console.log('从 GitHub 加载数据');
  
  const response = await fetch(githubDataUrl);
  if (!response.ok) {
    throw new Error(`无法加载基金数据: ${response.status}`);
  }
  
  return await response.json();
}

async function fetchMarketData(fundsData) {
  const fundTqCodes = fundsData.funds.map(f => f.tq);
  const indexTqCodes = [...new Set(
    fundsData.funds.flatMap(f => {
      if (Array.isArray(f.benchmark)) {
        return f.benchmark.map(b => b.tq);
      } else if (f.benchmark && typeof f.benchmark === 'object') {
        return [f.benchmark.tq];
      } else if (f.benchmark) {
        return [f.benchmark];
      }
      return [];
    })
  )];
  
  const allTqCodes = [...new Set([...fundTqCodes, ...indexTqCodes])].join(',');
  const url = `https://qt.gtimg.cn/q=${allTqCodes}&_=${Date.now()}`;
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    const fundMarketData = {};
    const indexData = {};
    
    const lines = text.split(';');
    
    lines.forEach(line => {
      if (!line) return;
      const match = line.match(/v_(\w+)="([^"]+)"/);
      if (match) {
        const tqCode = match[1];
        const parts = match[2].split('~');
        
        if (parts.length >= 10) {
          const price = parseFloat(parts[3]);
          const prevClose = parseFloat(parts[4]);
          
          if (price > 0) {
            const change = prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0;
            
            if (fundTqCodes.includes(tqCode)) {
              fundMarketData[tqCode] = { price, prevClose, change };
            } else {
              indexData[tqCode] = change;
            }
          }
        }
      }
    });
    
    return { fundMarketData, indexData };
  } catch (error) {
    console.error('获取行情数据失败:', error);
    throw error;
  }
}

async function sendFeishuAlert(env, errorMsg) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: `${timeStr}\n${errorMsg}` }
    })
  });
}

async function sendTestAlert(env, funds) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let message = `检测时间: ${timeStr}\n\n`;
  
  funds.slice(0, 10).forEach(({ fund, premiumRate }) => {
    const quotaStatus = fund.quota || '未知';
    const premiumStr = premiumRate >= 0 ? `+${premiumRate.toFixed(2)}%` : `${premiumRate.toFixed(2)}%`;
    message += `• ${fund.code} ${fund.name}: ${premiumStr} (${quotaStatus})\n`;
  });
  
  if (funds.length > 10) {
    message += `\n...\n（还有 ${funds.length - 10} 只基金未显示）`;
  }
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: message }
    })
  });
}

async function sendGlobalAlert(env, funds) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let message = `检测时间: ${timeStr}\n\n`;
  
  funds.forEach(({ fund, premiumRate }) => {
    const quotaStatus = fund.quota || '未知';
    const premiumStr = premiumRate >= 0 ? `+${premiumRate.toFixed(2)}%` : `${premiumRate.toFixed(2)}%`;
    message += `• ${fund.code} ${fund.name}: ${premiumStr} (${quotaStatus})\n`;
  });
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: message }
    })
  });
}

async function sendDynamicAlerts(env, alerts, fundsData) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let message = `检测时间: ${timeStr}\n\n`;
  
  alerts.forEach(alert => {
    const fund = fundsData.funds.find(f => f.code === alert.fundCode);
    const fundName = fund?.name || alert.fundCode;
    const quotaStatus = fund?.quota || '未知';
    
    message += `• ${alert.fundCode} ${fundName}: ${alert.type}\n`;
    message += `  当前溢价率：${alert.premium >= 0 ? '+' : ''}${alert.premium.toFixed(2)}%\n`;
    message += `  溢价变化：${alert.change >= 0 ? '+' : ''}${alert.change.toFixed(2)}%\n`;
    message += `  申购状态：${quotaStatus}\n`;
  });
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: message }
    })
  });
}
