import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FUNDS_JSON_PATH = path.join(__dirname, './data/funds.json');

let FUNDS = [];
let BENCH = {};
let INDEX_NAMES = {};

async function loadFundsData() {
  try {
    const data = fs.readFileSync(FUNDS_JSON_PATH, 'utf-8');
    const jsonData = JSON.parse(data);
    
    FUNDS = jsonData.funds || [];
    INDEX_NAMES = jsonData.indexNames || {};
    
    BENCH = {};
    FUNDS.forEach(fund => {
      if (fund.benchmark) {
        BENCH[fund.code] = fund.benchmark;
      }
    });
    
    console.log(`成功加载 ${FUNDS.length} 只基金数据`);
  } catch (error) {
    console.error('加载funds.json失败:', error.message);
    process.exit(1);
  }
}

const ALL_TQ_CODES = [
  ...FUNDS.map(fund => fund.tq),
  ...Object.values(BENCH).flatMap(bench => Array.isArray(bench) ? bench.map(item => item.tq) : [bench])
];

function getAllTqCodes() {
  return [
    ...FUNDS.map(fund => fund.tq),
    ...Object.values(BENCH).flatMap(bench => Array.isArray(bench) ? bench.map(item => item.tq) : [bench])
  ];
}

async function fetchTencentData() {
  const codes = [...new Set(getAllTqCodes())].join(',');
  const url = `https://qt.gtimg.cn/q=${codes}&_=${Date.now()}`;
  
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
        const data = match[2];
        const parts = data.split('~');
        
        if (parts.length >= 10) {
          const price = parseFloat(parts[3]);
          const prevClose = parseFloat(parts[4]);
          
          if (price > 0) {
            const change = prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0;
            
            const isFund = FUNDS.some(fund => fund.tq === code);
            if (isFund) {
              result.funds[code] = {
                price,
                prevClose,
                change
              };
            } else {
              result.indices[code] = {
                price,
                change
              };
            }
          }
        }
      }
    });
    
    return result;
  } catch (error) {
    console.error('获取腾讯财经数据失败:', error);
    return { funds: {}, indices: {} };
  }
}

async function fetchEastmoney() {
  const EM_CODES = {
    'csi930917': '2.930917',
    'csi930914': '2.930914',
    'csi930792': '2.930792',
    'sh000985':  '1.000985',
    'sh000066':  '1.000066',
    'sh000945':  '1.000945',
  };
  
  try {
    const results = await Promise.all(Object.entries(EM_CODES).map(([key, secid]) =>
      fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f169,f170,f3,f14&_=${Date.now()}`)
        .then(r => r.json())
        .then(d => {
          if (d.data && d.data.f43 > 0) {
            const chg = (d.data.f170 || 0) / 100;
            const time = d.data.f14 || '';
            return [key, chg, time];
          }
          return null;
        })
        .catch(e => {
          console.error(`获取东方财富数据失败 (${key}):`, e);
          return null;
        })
    ));
    
    const out = {};
    const times = {};
    results.forEach(r => {
      if (r) {
        out[r[0]] = r[1];
        times[r[0]] = r[2] || '';
      }
    });
    
    return { data: out, times: times };
  } catch (error) {
    console.error('获取东方财富数据失败:', error);
    return { data: {}, times: {} };
  }
}

async function fetchWithHeaders(url, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://fund.eastmoney.com/',
    'Connection': 'keep-alive'
  };
  
  try {
    const response = await fetch(url, { 
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('网络请求超时:', url);
    } else {
      console.error('网络请求失败:', error);
    }
    throw error;
  }
}

async function fetchNavFromPingzhong(fund) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${fund.code}.js?v=${Date.now()}`;
  
  try {
    const response = await fetchWithHeaders(url);
    const text = await response.text();
    
    if (!text || text.trim() === '') {
      console.log(`获取${fund.code}pingzhongdata数据失败: 返回空数据`);
      return null;
    }
    
    const netWorthMatch = text.match(/Data_netWorthTrend\s*=\s*(\[.+?\]);/s);
    if (netWorthMatch && netWorthMatch[1]) {
      try {
        const dataArray = JSON.parse(netWorthMatch[1]);
        if (dataArray && dataArray.length > 0) {
          const lastData = dataArray[dataArray.length - 1];
          const nav = parseFloat(lastData.y || lastData[1]);
          const date = lastData.x ? new Date(lastData.x).toISOString().slice(0, 10) : '';
          
          if (nav > 0) {
            return { nav, date };
          }
        }
      } catch (parseError) {
        console.error(`解析${fund.code}pingzhongdata数据失败:`, parseError);
      }
    }
    
    const acWorthMatch = text.match(/Data_ACWorthTrend\s*=\s*(\[.+?\]);/s);
    if (acWorthMatch && acWorthMatch[1]) {
      try {
        const dataArray = JSON.parse(acWorthMatch[1]);
        if (dataArray && dataArray.length > 0) {
          const lastData = dataArray[dataArray.length - 1];
          const nav = parseFloat(Array.isArray(lastData) ? lastData[1] : lastData.y);
          const date = lastData.x ? new Date(lastData.x).toISOString().slice(0, 10) : '';
          
          if (nav > 0) {
            return { nav, date };
          }
        }
      } catch (parseError) {
        console.error(`解析${fund.code}ACWorthTrend数据失败:`, parseError);
      }
    }
    
    return null;
  } catch (error) {
    console.error(`获取${fund.code}pingzhongdata数据失败:`, error);
    return null;
  }
}

async function fetchNavFromLsjz(fund) {
  const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${fund.code}&pageIndex=1&pageSize=1&_=${Date.now()}`;
  
  try {
    const response = await fetchWithHeaders(url);
    const data = await response.json();
    
    if (data && data.Data && data.Data.LSJZList && data.Data.LSJZList[0]) {
      const item = data.Data.LSJZList[0];
      const nav = parseFloat(item.DWJZ);
      const date = item.FSRQ || '';
      
      if (nav > 0) {
        return { nav, date };
      }
    }
    return null;
  } catch (error) {
    console.error(`获取${fund.code}lsjz数据失败:`, error);
    return null;
  }
}

async function fetchNav(fund) {
  const url = `https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`;
  
  try {
    const response = await fetchWithHeaders(url);
    const text = await response.text();
    
    if (!text || text.trim() === '') {
      console.log(`获取${fund.code}净值数据失败: 返回空数据`);
      return null;
    }
    
    const match = text.match(/jsonpgz\(([^)]+)\)/);
    if (!match || !match[1]) {
      console.log(`获取${fund.code}净值数据失败: JSONP格式错误`);
      return null;
    }
    
    try {
      const data = JSON.parse(match[1]);
      if (data) {
        const nav = parseFloat(data.dwjz || data.data?.dwjz);
        const date = data.jzrq || data.data?.jzrq || '';
        
        if (nav > 0) {
          return { nav, date };
        }
      }
      return null;
    } catch (parseError) {
      console.error(`获取${fund.code}净值数据失败: JSON解析错误`, parseError);
      return null;
    }
  } catch (error) {
    console.error(`获取${fund.code}净值数据失败:`, error);
    return null;
  }
}

async function fetchNavFromEM(fund) {
  try {
    const [pingzhongResult, lsjzResult, fundgzResult] = await Promise.all([
      fetchNavFromPingzhong(fund),
      fetchNavFromLsjz(fund),
      fetchNav(fund)
    ]);
    
    const results = [pingzhongResult, lsjzResult, fundgzResult].filter(result => result && result.nav > 0);
    
    if (results.length === 0) {
      return null;
    }
    
    results.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
    
    return results[0];
  } catch (error) {
    console.error(`获取${fund.code}东方财富净值数据失败:`, error);
    return null;
  }
}

async function loadNavs() {
  const BATCH_SIZE = 10;
  let loaded = 0;
  const navData = {};
  
  for (let i = 0; i < FUNDS.length; i += BATCH_SIZE) {
    const batch = FUNDS.slice(i, i + BATCH_SIZE);
    console.log(`处理批次 ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(FUNDS.length/BATCH_SIZE)}: ${batch.map(f => f.code).join(', ')}`);
    
    const results = await Promise.all(batch.map(async (fund) => {
      const fundTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`获取${fund.code}超时`)), 15000);
      });
      
      try {
        const result = await Promise.race([
          fetchNavFromEM(fund),
          fundTimeout
        ]);
        
        if (result && result.nav > 0) {
          console.log(`成功获取${fund.code}净值数据: ${result.nav} (${result.date})`);
          return result;
        }
        
        console.log(`所有API获取${fund.code}净值数据都失败`);
        return null;
      } catch (error) {
        console.error(`获取${fund.code}净值数据失败:`, error.message);
        return null;
      }
    }));
    
    results.forEach((result, index) => {
      const fund = batch[index];
      if (result && result.nav > 0) {
        navData[fund.code] = result;
        loaded++;
      }
    });
    
    if (i + BATCH_SIZE < FUNDS.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`净值数据加载完成，成功获取 ${loaded}/${FUNDS.length} 只基金的数据`);
  return navData;
}

async function saveNavData(navData) {
  try {
    const dataContent = fs.readFileSync(FUNDS_JSON_PATH, 'utf-8');
    const jsonData = JSON.parse(dataContent);
    
    // 更新每只基金的净值
    let updatedCount = 0;
    for (const fund of jsonData.funds) {
      const navInfo = navData[fund.code];
      if (navInfo && navInfo.nav > 0) {
        fund.nav = navInfo.nav;
        fund.navDate = navInfo.date;
        updatedCount++;
      }
    }
    
    jsonData.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(FUNDS_JSON_PATH, JSON.stringify(jsonData, null, 2), 'utf-8');
    console.log(`成功保存 ${updatedCount} 只基金的净值到 ${FUNDS_JSON_PATH}`);
  } catch (error) {
    console.error('保存净值数据失败:', error);
  }
}

async function fetchSinaData() {
  const funds = {};
  
  try {
    const fundCodes = FUNDS.map(fund => fund.tq).join(',');
    const url = `https://hq.sinajs.cn/list=${fundCodes}`;
    const response = await fetch(url);
    const text = await response.text();
    
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line) continue;
      
      const match = line.match(/^var hq_str_(\w+)="([^"]+)"/);
      if (!match) continue;
      
      const code = match[1];
      const data = match[2].split(',');
      
      if (data.length >= 4) {
        const price = parseFloat(data[3]);
        const prevClose = parseFloat(data[2]);
        
        if (price > 0 && prevClose > 0) {
          const change = (price - prevClose) / prevClose * 100;
          funds[code] = {
            price,
            prevClose,
            change
          };
        }
      }
    }
  } catch (error) {
    console.error('获取新浪财经数据失败:', error);
  }
  
  return { funds };
}

async function checkAbnormalPremium() {
  const threshold = 3;
  const abnormalFunds = [];
  
  try {
    console.log('开始获取数据...');
    
    const [tencentData, eastmoneyData, navData, sinaData] = await Promise.all([
      fetchTencentData(),
      fetchEastmoney(),
      loadNavs(),
      fetchSinaData()
    ]);
    
    // 把获取到的净值保存回 data/funds.json
    await saveNavData(navData);
    
    console.log('数据获取完成');
    console.log('腾讯财经数据:', Object.keys(tencentData.funds).length, '只基金');
    console.log('新浪财经数据:', Object.keys(sinaData.funds).length, '只基金');
    console.log('净值数据:', Object.keys(navData).length, '只基金');
    
    const indexData = { ...tencentData.indices, ...eastmoneyData.data };
    console.log('指数数据:', Object.keys(indexData).length, '个指数');
    
    const allFundsData = { ...sinaData.funds, ...tencentData.funds };
    console.log('合并后基金数据:', Object.keys(allFundsData).length, '只基金');
    
    console.log('开始处理基金数据...');
    for (const fund of FUNDS) {
      try {
        const fundData = allFundsData[fund.tq];
        if (!fundData || !fundData.price) {
          console.log(`未获取到${fund.code} ${fund.name}的场内价格`);
          continue;
        }
        
        const navInfo = navData[fund.code];
        if (!navInfo || !navInfo.nav) {
          console.log(`未获取到${fund.code} ${fund.name}的净值数据`);
          continue;
        }
        
        const benchCode = BENCH[fund.code];
        let benchChange = 0;
        
        if (benchCode) {
          if (Array.isArray(benchCode)) {
            let totalWeight = 0;
            let weightedChange = 0;
            
            for (const bench of benchCode) {
              if (bench.tq && indexData[bench.tq] && typeof indexData[bench.tq].change === 'number') {
                weightedChange += indexData[bench.tq].change * bench.w;
                totalWeight += bench.w;
              }
            }
            
            if (totalWeight > 0) {
              benchChange = weightedChange / totalWeight;
            }
          } else if (indexData[benchCode] && typeof indexData[benchCode].change === 'number') {
            benchChange = indexData[benchCode].change;
          }
        }
        
        benchChange = benchChange || 0;
        
        let estimatedNav = navInfo.nav;
        if (benchChange !== 0) {
          estimatedNav = navInfo.nav * (1 + benchChange / 100);
        }
        
        const premium = ((fundData.price - estimatedNav) / estimatedNav) * 100;
        
        console.log(`${fund.code} ${fund.name}: 价格=${fundData.price.toFixed(4)}, 净值=${navInfo.nav.toFixed(4)}, 预估净值=${estimatedNav.toFixed(4)}, 溢价率=${premium.toFixed(2)}%`);
        
        if (Math.abs(premium) >= threshold) {
          abnormalFunds.push({
            code: fund.code,
            name: fund.name,
            premium: premium
          });
        }
      } catch (error) {
        console.error(`处理${fund.code} ${fund.name}数据失败:`, error);
      }
    }
    
    console.log(`处理完成，发现${abnormalFunds.length}只异常基金`);
  } catch (error) {
    console.error('检查溢价率异常失败:', error);
  }
  
  return abnormalFunds;
}

function buildPushMessage(funds) {
  const now = new Date(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  const beijingTime = now.toLocaleString('zh-CN');
  let message = `【LOF基金溢价率异常提醒】\n\n`;
  message += `检测时间: ${beijingTime}\n\n`;
  message += `溢价率异常的基金:\n\n`;
  
  const sortedFunds = [...funds].sort((a, b) => b.premium - a.premium);
  
  sortedFunds.forEach(fund => {
    const premiumStr = fund.premium >= 0 ? `+${fund.premium.toFixed(2)}%` : `${fund.premium.toFixed(2)}%`;
    message += `• ${fund.code} ${fund.name}: ${premiumStr}\n`;
  });
  
  message += `\n数据来源: LOF基金监控系统`;
  return message;
}

async function sendToFeishu(message) {
  const webhookUrl = process.env.FEISHU_WEBHOOK;
  
  if (!webhookUrl) {
    console.error('飞书webhook地址未配置');
    return;
  }
  
  const feishuMessage = {
    msg_type: 'text',
    content: {
      text: message
    }
  };
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(feishuMessage)
    });
    
    const data = await response.json();
    console.log('飞书消息推送结果:', data);
  } catch (error) {
    console.error('飞书消息推送失败:', error);
  }
}

async function main() {
  console.log('开始检查基金溢价率...');
  
  await loadFundsData();
  
  const abnormalFunds = await checkAbnormalPremium();
  
  if (abnormalFunds.length > 0) {
    console.log(`发现${abnormalFunds.length}只基金溢价率异常`);
    const message = buildPushMessage(abnormalFunds);
    await sendToFeishu(message);
  } else {
    console.log('未发现溢价率异常的基金');
  }
  
  console.log('检查完成');
}

main();
