export default {
  async scheduled(event, env, ctx) {
    console.log('开始执行 LOF 基金智能监控任务');
    ctx.waitUntil(smartMonitor(env));
  },

  async fetch(request, env, ctx) {
    return new Response('LOF 基金智能监控服务', {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  },
};

// 全局变量：存储溢价历史（用于趋势分析）
const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

async function smartMonitor(env) {
  try {
    const now = new Date();
    const hour = now.getHours() + 8; // UTC+8
    const minute = now.getMinutes();
    
    // 1. 检查是否是9:25（全局报警时间）
    const isGlobalAlertTime = hour === 9 && minute === 25;
    
    // 2. 加载基金数据
    const fundsData = await loadFundsData(env);
    
    // 3. 获取实时行情
    const marketData = await fetchMarketData(fundsData);
    
    // 4. 检查溢价
    const alerts = [];
    const allAbnormalFunds = [];
    
    for (const fund of fundsData.funds) {
      const marketInfo = marketData.funds[fund.tq];
      if (!marketInfo || !fund.nav) continue;
      
      const premiumRate = ((marketInfo.price - fund.nav) / fund.nav) * 100;
      const threshold = fund.premiumThreshold || 3;
      
      // 收集所有异常基金（用于9:25全局报警）
      if (Math.abs(premiumRate) >= threshold) {
        allAbnormalFunds.push({ fund, marketInfo, premiumRate });
      }
      
      // 动态检测：溢价突然变化
      const dynamicAlert = checkDynamicChange(fund.code, premiumRate, marketInfo);
      if (dynamicAlert) {
        alerts.push(dynamicAlert);
      }
    }
    
    // 5. 9:25 全局报警（发送所有异常基金）
    if (isGlobalAlertTime && allAbnormalFunds.length > 0) {
      await sendGlobalAlert(env, allAbnormalFunds);
      console.log(`9:25 全局报警：${allAbnormalFunds.length} 只异常基金`);
    }
    
    // 6. 动态报警（单独推送）
    if (!isGlobalAlertTime && alerts.length > 0) {
      await sendDynamicAlerts(env, alerts);
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

function checkDynamicChange(fundCode, currentPremium, marketInfo) {
  const now = Date.now();
  
  // 初始化历史记录
  if (!PREMIUM_HISTORY[fundCode]) {
    PREMIUM_HISTORY[fundCode] = [];
  }
  
  // 添加当前溢价记录
  PREMIUM_HISTORY[fundCode].push({
    time: now,
    premium: currentPremium
  });
  
  // 只保留最近10分钟的数据（约10条记录）
  if (PREMIUM_HISTORY[fundCode].length > 10) {
    PREMIUM_HISTORY[fundCode].shift();
  }
  
  const history = PREMIUM_HISTORY[fundCode];
  
  // 至少需要3条记录才能判断趋势
  if (history.length < 3) return null;
  
  // 计算5分钟前的平均溢价
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  const recentHistory = history.filter(h => h.time > fiveMinutesAgo);
  
  if (recentHistory.length < 2) return null;
  
  const avgPremium = recentHistory.reduce((sum, h) => sum + h.premium, 0) / recentHistory.length;
  const premiumChange = currentPremium - avgPremium;
  
  // 判断是否突然变化（溢价上升超过1.5% 或 折价加深超过1.5%）
  const suddenChange = Math.abs(premiumChange) >= 1.5;
  
  // 判断是否超过阈值
  const overThreshold = Math.abs(currentPremium) >= (marketInfo.fund?.premiumThreshold || 3);
  
  // 检查冷却时间（同一基金10分钟内只报警一次）
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
      time: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    };
  }
  
  return null;
}

async function sendGlobalAlert(env, abnormalFunds) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let content = `${timeStr}\n📢 【9:25 开盘溢价汇总】\n\n`;
  
  abnormalFunds.forEach(item => {
    const { fund, marketInfo, premiumRate } = item;
    const emoji = premiumRate >= 0 ? '📈' : '📉';
    content += `${emoji} ${fund.name}(${fund.code})\n` +
      `  场内价格: ${marketInfo.price.toFixed(4)}\n` +
      `  最新净值: ${fund.nav.toFixed(4)}\n` +
      `  溢价率: ${premiumRate >= 0 ? '+' : ''}${premiumRate.toFixed(2)}%\n\n`;
  });
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: content }
    })
  });
}

async function sendDynamicAlerts(env, alerts) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  for (const alert of alerts) {
    const { fundCode, premium, change, marketInfo, type, time } = alert;
    
    // 获取基金信息
    const fund = (await loadFundsData(env)).funds.find(f => f.code === fundCode);
    
    const emoji = change > 0 ? '🚨' : '⚠️';
    const content = `${time}\n${emoji} 【${type}】\n` +
      `${fund?.name || fundCode}(${fundCode})\n` +
      `场内价格: ${marketInfo.price.toFixed(4)}\n` +
      `溢价率: ${premium >= 0 ? '+' : ''}${premium.toFixed(2)}%\n` +
      `5分钟变化: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: content }
      })
    });
    
    await new Promise(resolve => setTimeout(resolve, 500)); // 避免频率限制
  }
}

// 以下是辅助函数（与之前相同）
async function loadFundsData(env) {
  try {
    const githubDataUrl = env.GITHUB_DATA_URL || 'https://your-username.github.io/repo-name/data/funds.json';
    const response = await fetch(githubDataUrl);
    if (!response.ok) throw new Error(`无法加载基金数据: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('加载基金数据失败:', error);
    throw error;
  }
}

async function fetchMarketData(fundsData) {
  const tqCodes = [
    ...fundsData.funds.map(f => f.tq),
    ...Object.values(fundsData.funds.reduce((acc, f) => {
      if (f.benchmark) {
        const benches = Array.isArray(f.benchmark) ? f.benchmark : [f.benchmark];
        benches.forEach(b => acc[b.tq] = true);
      }
      return acc;
    }, {})).map(tq => tq)
  ];
  
  const uniqueCodes = [...new Set(tqCodes)].join(',');
  const url = `https://qt.gtimg.cn/q=${uniqueCodes}&_=${Date.now()}`;
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    const result = { funds: {}, indices: {} };
    const lines = text.split(';');
    
    lines.forEach(line => {
      if (!line) return;
      const match = line.match(/v_(\w+)="([^"]+)"/);
      if (match) {
        const code = match[1];
        const data = match[2].split('~');
        if (data.length >= 10) {
          const price = parseFloat(data[3]);
          const prevClose = parseFloat(data[4]);
          if (price > 0) {
            const change = prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0;
            const isFund = fundsData.funds.some(f => f.tq === code);
            if (isFund) {
              result.funds[code] = { price, prevClose, change };
            } else {
              result.indices[code] = { price, prevClose, change };
            }
          }
        }
      }
    });
    
    return result;
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
