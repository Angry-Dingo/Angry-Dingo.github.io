export default {
  async scheduled(event, env, ctx) {
    console.log('开始执行 LOF 基金智能监控任务');
    ctx.waitUntil(smartMonitor(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/test') {
      console.log('触发测试');
      ctx.waitUntil(smartMonitor(env, true));
      return new Response('测试已触发，请查看飞书', {
        status: 200,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
    }
    
    return new Response('LOF 基金智能监控服务', {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  },
};

const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

function isTradingHour(hour, minute) {
  // 工作日 9:25-11:30 和 13:00-15:00
  const morningStart = hour === 9 && minute >= 25;
  const morningEnd = hour < 11 || (hour === 11 && minute <= 30);
  const afternoonStart = hour >= 13;
  const afternoonEnd = hour < 15 || (hour === 15 && minute === 0);
  
  return (morningStart && morningEnd) || (afternoonStart && afternoonEnd);
}

function isGlobalAlertTime(hour, minute) {
  // 9:25 发送一次全局提醒
  return hour === 9 && minute === 25;
}

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const hour = beijingTime.getUTCHours();
    const minute = beijingTime.getUTCMinutes();
    const day = beijingTime.getUTCDay(); // 0-6, 0是周日, 6是周六
    
    console.log(`当前时间(UTC): ${now.toISOString()}, 北京时间: ${hour}:${minute}, 周${day}`);
    
    // 只在工作日（1-5）和交易时间内运行
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
        console.log(`9:25 全局报警：${allAbnormalFunds.length} 只异常基金`);
      }
    }
    
    if (!isGlobalAlert && alerts.length > 0) {
      await sendDynamicAlerts(env, alerts, fundsData);
      console.log(`动态报警：${alerts.length} 条`);
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
  const githubDataUrl = env.GITHUB_DATA_URL || 'https://raw.githubusercontent.com/Angry-Dingo/Angry-Dingo.github.io/main/data/funds.json';
  
  try {
    console.log('正在加载数据:', githubDataUrl);
    
    const response = await fetch(githubDataUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP 错误:', response.status, errorText);
      throw new Error(`无法加载基金数据: ${response.status}`);
    }
    
    const text = await response.text();
    console.log('收到数据长度:', text.length, '字节');
    
    return JSON.parse(text);
  } catch (error) {
    console.error('加载基金数据失败:', error);
    throw error;
  }
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
      content: { text: `${timeStr}\n❌ ${errorMsg}` }
    })
  });
}

async function sendTestAlert(env, funds) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) {
    console.error('未配置 FEISHU_WEBHOOK');
    return;
  }
  
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
  if (!webhookUrl) {
    console.error('未配置 FEISHU_WEBHOOK');
    return;
  }
  
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
