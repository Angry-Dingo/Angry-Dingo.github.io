// 使用ESM模块导入
import fetch from 'node-fetch';

// 从HTML文件中提取的基金数据
const FUNDS = [
  {code:'160140', ocode:'160140', name:'美国REIT精选LOF', tq:'sz160140', category:'us', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'501021', ocode:'501021', name:'香港中小LOF', tq:'sz501021', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'161124', ocode:'161124', name:'港股小盘LOF', tq:'sz161124', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'164701', ocode:'164701', name:'黄金LOF', tq:'sz164701', category:'cm', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'165513', ocode:'165513', name:'中信保诚商品LOF', tq:'sz165513', category:'cm', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'161217', ocode:'161217', name:'国投上游资源LOF', tq:'sz161217', category:'cm', quota:'开放', fee:'1.50%', rfee:'0.50%'},
  {code:'161715', ocode:'161715', name:'招商大宗商品LOF', tq:'sz161715', category:'cm', quota:'开放', fee:'1.50%', rfee:'0.50%'}
];

// 基准指数
const BENCH = {
  '160140': 'usRWR', // 道琼斯美国精选REIT指数
  '501021': 'hkHSTECH', // 恒生科技指数
  '161124': 'hkHSSI', // 恒生综合小型股指数
  '164701': 'usGLD', // 黄金ETF
  '165513': 'usGLD', // 黄金ETF
  '161217': 'sh000945', // 中证上游资源产业指数
  '161715': 'sh000066' // 上证大宗商品股票指数
};

// 所有腾讯财经代码
const ALL_TQ_CODES = FUNDS.map(fund => fund.tq).concat(Object.values(BENCH));

// 从腾讯财经获取实时行情数据
async function fetchTencentData() {
  const codes = [...new Set(ALL_TQ_CODES)].join(',');
  const url = `https://qt.gtimg.cn/q=${codes}&_=${Date.now()}`;
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    const result = { funds: {}, indices: {} };
    
    // 解析腾讯财经返回的数据
    const lines = text.split(';');
    lines.forEach(line => {
      if (!line) return;
      
      // 提取变量名和数据
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
            
            // 判断是基金还是指数
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

// 东方财富push2 — 用于腾讯qt不支持的指数
async function fetchEastmoney() {
  const EM_CODES = {
    'csi930917': '2.930917',  // 中证沪港深高股息指数
    'csi930914': '2.930914',  // 中证港股通高股息投资指数
    'csi930792': '2.930792',  // 中证港股通香港银行指数
    'sh000985':  '1.000985',  // 中证综合债券指数
    'sh000066':  '1.000066',  // 上证大宗商品股票指数
    'sh000945':  '1.000945',  // 中证上游资源产业指数
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

// 从天天基金获取净值数据
async function fetchNav(fund) {
  const url = `https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`;
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    // 解析JSONP数据
    const match = text.match(/jsonpgz\(([^)]+)\)/);
    if (match) {
      const data = JSON.parse(match[1]);
      if (data && data.data) {
        return {
          nav: parseFloat(data.data.dwjz),
          date: data.data.gztime
        };
      }
    }
    return null;
  } catch (error) {
    console.error(`获取${fund.code}净值数据失败:`, error);
    return null;
  }
}

// 从东方财富获取净值数据（用于某些特殊基金）
async function fetchNavFromEM(fund) {
  const url = `https://push2.eastmoney.com/api/qt/fund/newfund/detail/get?fundCode=${fund.code}&_=${Date.now()}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.data && data.data.fundBaseInfo) {
      const nav = parseFloat(data.data.fundBaseInfo.FUNDDWJZ);
      const date = data.data.fundBaseInfo.FUNDDWJZDATE;
      
      if (nav > 0) {
        return {
          nav,
          date
        };
      }
    }
    return null;
  } catch (error) {
    console.error(`获取${fund.code}东方财富净值数据失败:`, error);
    return null;
  }
}

// 加载所有基金的净值数据
async function loadNavs() {
  const BATCH_SIZE = 15;
  let loaded = 0;
  const navData = {};
  
  for (let i = 0; i < FUNDS.length; i += BATCH_SIZE) {
    const batch = FUNDS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fund => {
      return fetchNav(fund);
    }));
    
    results.forEach((result, index) => {
      const fund = batch[index];
      if (result && result.nav > 0) {
        navData[fund.code] = result;
        loaded++;
      }
    });
  }
  
  return navData;
}

// 检查溢价率异常
async function checkAbnormalPremium() {
  const threshold = 3; // 3%的阈值
  const abnormalFunds = [];
  
  try {
    // 并行获取数据
    const [tencentData, eastmoneyData, navData] = await Promise.all([
      fetchTencentData(),
      fetchEastmoney(),
      loadNavs()
    ]);
    
    // 合并指数数据
    const indexData = { ...tencentData.indices, ...eastmoneyData.data };
    
    // 处理基金数据
    for (const fund of FUNDS) {
      try {
        // 获取场内价格
        const fundData = tencentData.funds[fund.tq];
        if (!fundData || !fundData.price) {
          console.log(`未获取到${fund.code} ${fund.name}的场内价格`);
          continue;
        }
        
        // 获取净值数据
        const navInfo = navData[fund.code];
        if (!navInfo || !navInfo.nav) {
          console.log(`未获取到${fund.code} ${fund.name}的净值数据`);
          continue;
        }
        
        // 获取基准指数涨跌幅
        const benchCode = BENCH[fund.code];
        let benchChange = 0;
        
        if (benchCode && indexData[benchCode]) {
          benchChange = indexData[benchCode];
        }
        
        // 计算预估净值
        const estimatedNav = navInfo.nav * (1 + benchChange / 100);
        
        // 计算溢价率
        const premium = ((fundData.price - estimatedNav) / estimatedNav) * 100;
        
        console.log(`${fund.code} ${fund.name}: 价格=${fundData.price.toFixed(4)}, 净值=${navInfo.nav.toFixed(4)}, 预估净值=${estimatedNav.toFixed(4)}, 溢价率=${premium.toFixed(2)}%`);
        
        // 检查是否异常
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
  } catch (error) {
    console.error('检查溢价率异常失败:', error);
  }
  
  return abnormalFunds;
}

// 构建推送消息
function buildPushMessage(funds) {
  const now = new Date().toLocaleString('zh-CN');
  let message = `【LOF基金溢价率异常提醒】\n\n`;
  message += `检测时间: ${now}\n\n`;
  message += `溢价率异常的基金:\n\n`;
  
  funds.forEach(fund => {
    const premiumStr = fund.premium >= 0 ? `+${fund.premium.toFixed(2)}%` : `${fund.premium.toFixed(2)}%`;
    message += `• ${fund.code} ${fund.name}: ${premiumStr}\n`;
  });
  
  message += `\n数据来源: LOF基金监控系统`;
  return message;
}

// 发送消息到飞书机器人
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

// 主函数
async function main() {
  console.log('开始检查基金溢价率...');
  
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

// 运行主函数
main();