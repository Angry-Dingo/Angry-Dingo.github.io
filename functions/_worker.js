export default {
  async scheduled(event, env, ctx) {
    console.log('开始执行 LOF 基金智能监控任务');
    ctx.waitUntil(smartMonitor(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/test') {
      console.log('触发测试');
      ctx.waitUntil(smartMonitor(env, true)); // 第二个参数 = 强制测试模式
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

// 全局变量：存储溢价历史（用于趋势分析）
const PREMIUM_HISTORY = {};
const LAST_ALERT_TIME = {};

async function smartMonitor(env, isTestMode = false) {
  try {
    const now = new Date();
    // 正确计算北京时间 (UTC+8)
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const hour = beijingTime.getUTCHours();
    const minute = beijingTime.getUTCMinutes();
    
    console.log(`当前时间(UTC): ${now.toISOString()}, 北京时间: ${hour}:${minute}`);
    
    // 1. 检查是否是9:25（全局报警时间）或 测试模式
    const isGlobalAlertTime = isTestMode || (hour === 9 && minute === 25);
    
    // 2. 加载基金数据
    const fundsData = await loadFundsData(env);
    
    // 3. 获取实时行情
    const marketData = await fetchMarketData(fundsData);
    
    // 4. 获取基金净值
    console.log('开始获取基金净值...');
    const navData = await fetchAllNavs(fundsData.funds);
    console.log(`净值获取完成: ${Object.keys(navData).length} 只基金`);
    
    // 5. 检查溢价
    const alerts = [];
    const allAbnormalFunds = [];
    const allFundsForDebug = []; // 用于调试
    
    console.log(`开始检查 ${fundsData.funds.length} 只基金`);
    
    for (const fund of fundsData.funds) {
      const marketInfo = marketData.funds[fund.tq];
      const navInfo = navData[fund.code];
      
      if (!marketInfo || !navInfo) {
        console.log(`跳过 ${fund.code}: 缺少数据 (价格=${marketInfo?.price}, 净值=${navInfo?.nav})`);
        continue;
      }
      
      const nav = navInfo.nav;
      const premiumRate = ((marketInfo.price - nav) / nav) * 100;
      const threshold = fund.premiumThreshold || 3;
      
      console.log(`${fund.code} ${fund.name}: 价格=${marketInfo.price.toFixed(4)}, 净值=${nav.toFixed(4)}, 溢价率=${premiumRate.toFixed(2)}%`);
      
      // 用于调试的所有基金（不管溢价如何都记录下来
      // 把 nav 注入到 fund 对象中，方便后面使用
      const fundWithNav = { ...fund, nav };
      allFundsForDebug.push({ fund: fundWithNav, marketInfo, premiumRate });
      
      // 收集所有异常基金（用于9:25全局报警）
      if (isTestMode || Math.abs(premiumRate) >= threshold) {
        // 测试模式：收集前5只基金
        if (isTestMode && allAbnormalFunds.length >= 5) continue;
        allAbnormalFunds.push({ fund, marketInfo, premiumRate });
      }
      
      // 动态检测：溢价突然变化（测试模式下跳过，直接用全局报警）
      if (!isTestMode) {
        const dynamicAlert = checkDynamicChange(fund.code, premiumRate, marketInfo);
        if (dynamicAlert) {
          alerts.push(dynamicAlert);
        }
      }
    }
    
    console.log(`异常基金数量: ${allAbnormalFunds.length}, 动态报警数量: ${alerts.length}`);
    
    // 5. 9:25 全局报警（发送所有异常基金）或 测试模式
    if (isGlobalAlertTime) {
      if (isTestMode) {
        // 测试模式：即使没有异常基金也发送前几只用于调试
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
    
    // 6. 动态报警（单独推送）
    if (!isGlobalAlertTime && alerts.length > 0) {
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

// 测试模式专用的发送函数
async function sendTestAlert(env, testFunds) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let content = `${timeStr}\n🧪 【测试推送】\n\n`;
  
  testFunds.forEach(item => {
    const { fund, marketInfo, premiumRate } = item;
    const emoji = premiumRate >= 0 ? '📈' : '📉';
    content += `${emoji} ${fund.name}(${fund.code})\n` +
      `  场内价格: ${marketInfo.price.toFixed(4)}\n` +
      `  最新净值: ${fund.nav.toFixed(4)}\n` +
      `  溢价率: ${premiumRate >= 0 ? '+' : ''}${premiumRate.toFixed(2)}%\n\n`;
  });
  
  content += `✅ 飞书推送功能测试成功！`;
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: content }
    })
  });
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

async function sendDynamicAlerts(env, alerts, fundsData) {
  const webhookUrl = env.FEISHU_WEBHOOK;
  if (!webhookUrl) return;
  
  for (const alert of alerts) {
    const { fundCode, premium, change, marketInfo, type, time } = alert;
    
    // 获取基金信息
    const fund = fundsData.funds.find(f => f.code === fundCode);
    
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
    console.log('正在加载数据，URL:', githubDataUrl);
    
    const response = await fetch(githubDataUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP 错误:', response.status, errorText);
      throw new Error(`无法加载基金数据: ${response.status}`);
    }
    
    const text = await response.text();
    console.log('收到响应长度:', text.length, '字节');
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('JSON 解析失败，收到的内容:', text.slice(0, 200));
      throw new Error(`JSON 解析失败: ${parseError.message}`);
    }
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

// 以下是获取净值的函数
async function fetchAllNavs(funds) {
  const navData = {};
  const BATCH_SIZE = 8; // 减少批次大小以避免超时
  
  for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    console.log(`处理净值批次 ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(funds.length/BATCH_SIZE)}`);
    
    const results = await Promise.all(batch.map(async (fund) => {
      try {
        return await fetchSingleNav(fund);
      } catch (error) {
        console.error(`获取${fund.code}净值失败:`, error.message);
        return null;
      }
    }));
    
    results.forEach((result, index) => {
      const fund = batch[index];
      if (result && result.nav > 0) {
        navData[fund.code] = result;
      }
    });
    
    if (i + BATCH_SIZE < funds.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return navData;
}

async function fetchSingleNav(fund) {
  const fundCode = fund.code;
  
  try {
    // 先尝试最简单的 API (fundgz.1234567.com.cn)
    const result = await fetchNavFromFundgz(fundCode);
    if (result && result.nav > 0) {
      console.log(`${fundCode} 从 fundgz 获得净值: ${result.nav}`);
      return result;
    }
  } catch (e) {
    // 继续尝试下一个
  }
  
  try {
    // 尝试东方财富 lsjz API
    const result = await fetchNavFromLsjz(fundCode);
    if (result && result.nav > 0) {
      console.log(`${fundCode} 从 lsjz 获得净值: ${result.nav}`);
      return result;
    }
  } catch (e) {
    // 继续尝试下一个
  }
  
  try {
    // 尝试 pingzhongdata
    const result = await fetchNavFromPingzhong(fundCode);
    if (result && result.nav > 0) {
      console.log(`${fundCode} 从 pingzhongdata 获得净值: ${result.nav}`);
      return result;
    }
  } catch (e) {
    // 都失败了
  }
  
  return null;
}

async function fetchNavFromFundgz(fundCode) {
  const url = `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`;
  const response = await fetch(url);
  const text = await response.text();
  
  const match = text.match(/jsonpgz\(([^)]+)\)/);
  if (!match) return null;
  
  try {
    const data = JSON.parse(match[1]);
    const nav = parseFloat(data.dwjz);
    const date = data.jzrq;
    
    if (nav > 0) {
      return { nav, date };
    }
  } catch (e) {
    // 解析失败
  }
  
  return null;
}

async function fetchNavFromLsjz(fundCode) {
  const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${fundCode}&pageIndex=1&pageSize=1`;
  const response = await fetch(url, {
    headers: {
      'Referer': 'https://fund.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  const data = await response.json();
  
  if (data && data.Data && data.Data.LSJZList && data.Data.LSJZList[0]) {
    const item = data.Data.LSJZList[0];
    const nav = parseFloat(item.DWJZ);
    const date = item.FSRQ;
    
    if (nav > 0) {
      return { nav, date };
    }
  }
  
  return null;
}

async function fetchNavFromPingzhong(fundCode) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      'Referer': 'https://fund.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  const text = await response.text();
  
  // 尝试 Data_netWorthTrend
  let match = text.match(/Data_netWorthTrend\s*=\s*(\[.+?\]);/s);
  if (match) {
    try {
      const arr = JSON.parse(match[1]);
      if (arr && arr.length > 0) {
        const last = arr[arr.length - 1];
        const nav = parseFloat(last.y);
        if (nav > 0) {
          return { nav, date: new Date(last.x).toISOString().slice(0, 10) };
        }
      }
    } catch (e) {
      // 继续
    }
  }
  
  // 尝试 Data_ACWorthTrend
  match = text.match(/Data_ACWorthTrend\s*=\s*(\[.+?\]);/s);
  if (match) {
    try {
      const arr = JSON.parse(match[1]);
      if (arr && arr.length > 0) {
        const last = arr[arr.length - 1];
        const nav = Array.isArray(last) ? parseFloat(last[1]) : parseFloat(last.y);
        if (nav > 0) {
          return { nav, date: new Date(last.x || Date.now()).toISOString().slice(0, 10) };
        }
      }
    } catch (e) {
      // 继续
    }
  }
  
  return null;
}
