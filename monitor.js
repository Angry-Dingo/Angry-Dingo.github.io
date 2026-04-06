// 使用ESM模块导入
import fetch from 'node-fetch';

// 从HTML文件中提取的完整基金数据
const FUNDS = [
  // 欧美市场
  {code:'161127', ocode:'161127', name:'标普生物科技LOF', tq:'sz161127', category:'us', quota:'限10', fee:'1.20%', rfee:'1.00%'},
  {code:'164906', ocode:'164906', name:'中概互联网LOF', tq:'sz164906', category:'us', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'501312', ocode:'501312', name:'海外科技LOF', tq:'sh501312', category:'us', quota:'限2千', fee:'1.20%', rfee:'1.20%'},
  {code:'164824', ocode:'164824', name:'印度基金LOF', tq:'sz164824', category:'us', quota:'限1千', fee:'1.20%', rfee:'1.50%'},
  {code:'160644', ocode:'160644', name:'港美互联网LOF', tq:'sz160644', category:'hk', quota:'限10万', fee:'1.50%', rfee:'1.50%'},
  {code:'162415', ocode:'162415', name:'美国消费LOF', tq:'sz162415', category:'us', quota:'限500', fee:'1.20%', rfee:'1.50%'},
  {code:'161126', ocode:'161126', name:'标普医疗保健LOF', tq:'sz161126', category:'us', quota:'限10', fee:'1.20%', rfee:'1.00%'},
  {code:'161128', ocode:'161128', name:'标普信息科技LOF', tq:'sz161128', category:'us', quota:'限10', fee:'1.20%', rfee:'1.00%'},
  {code:'161125', ocode:'161125', name:'标普500LOF', tq:'sz161125', category:'us', quota:'限10', fee:'1.20%', rfee:'1.50%'},
  {code:'161130', ocode:'161130', name:'纳斯达克100LOF', tq:'sz161130', category:'us', quota:'限10', fee:'1.20%', rfee:'0.60%'},
  {code:'501300', ocode:'501300', name:'美元债LOF', tq:'sh501300', category:'us', quota:'限1万', fee:'0.80%', rfee:'1.50%'},
  {code:'160140', ocode:'160140', name:'美国REIT精选LOF', tq:'sz160140', category:'us', quota:'限100万', fee:'1.20%', rfee:'1.00%'},
  {code:'501225', ocode:'501225', name:'全球芯片LOF', tq:'sh501225', category:'us', quota:'暂停', fee:'1.50%', rfee:'1.50%'},
  // 欧美·商品
  {code:'160216', ocode:'160216', name:'国泰商品LOF', tq:'sz160216', category:'cm', quota:'限1千', fee:'1.50%', rfee:'1.50%'},
  {code:'161116', ocode:'161116', name:'黄金主题LOF', tq:'sz161116', category:'cm', quota:'暂停', fee:'0%', rfee:'1.50%'},
  {code:'164701', ocode:'164701', name:'黄金LOF', tq:'sz164701', category:'cm', quota:'限50', fee:'0.80%', rfee:'1.50%'},
  {code:'165513', ocode:'165513', name:'中信保诚商品LOF', tq:'sz165513', category:'cm', quota:'开放', fee:'1.60%', rfee:'1.50%'},
  {code:'160719', ocode:'160719', name:'嘉实黄金LOF', tq:'sz160719', category:'cm', quota:'暂停', fee:'1.20%', rfee:'1.50%'},
  {code:'161815', ocode:'161815', name:'抗通胀LOF', tq:'sz161815', category:'cm', quota:'开放', fee:'1.60%', rfee:'1.50%'},
  {code:'163208', ocode:'163208', name:'全球油气能源LOF', tq:'sz163208', category:'cm', quota:'暂停', fee:'1.50%', rfee:'1.50%'},
  {code:'501018', ocode:'501018', name:'南方原油LOF', tq:'sh501018', category:'cm', quota:'暂停', fee:'1.20%', rfee:'1.50%'},
  {code:'161129', ocode:'161129', name:'原油LOF易方达', tq:'sz161129', category:'cm', quota:'暂停', fee:'1.20%', rfee:'1.50%'},
  {code:'160723', ocode:'160723', name:'嘉实原油LOF', tq:'sz160723', category:'cm', quota:'暂停', fee:'1.20%', rfee:'1.50%'},
  {code:'162719', ocode:'162719', name:'石油LOF', tq:'sz162719', category:'cm', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'162411', ocode:'162411', name:'华宝油气LOF', tq:'sz162411', category:'cm', quota:'暂停', fee:'1.50%', rfee:'1.50%'},
  {code:'160416', ocode:'160416', name:'石油基金LOF', tq:'sz160416', category:'cm', quota:'暂停', fee:'1.20%', rfee:'1.50%'},
  // 亚洲市场·港股
  {code:'501303', ocode:'501303', name:'恒生中型股LOF', tq:'sh501303', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.60%'},
  {code:'161124', ocode:'161124', name:'港股小盘LOF', tq:'sz161124', category:'hk', quota:'限1千', fee:'1.20%', rfee:'1.00%'},
  {code:'160322', ocode:'160322', name:'港股精选LOF', tq:'sz160322', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'501021', ocode:'501021', name:'香港中小LOF', tq:'sh501021', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.20%'},
  {code:'501310', ocode:'501310', name:'价值基金LOF', tq:'sh501310', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.90%'},
  {code:'501302', ocode:'501302', name:'恒生指数基金LOF', tq:'sh501302', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.60%'},
  {code:'501307', ocode:'501307', name:'银河高股息LOF', tq:'sh501307', category:'hk', quota:'开放', fee:'1.00%', rfee:'0.68%'},
  {code:'501306', ocode:'501306', name:'港股高股息LOFC', tq:'sh501306', category:'hk', quota:'开放', fee:'0.00%', rfee:'0.60%'},
  {code:'160717', ocode:'160717', name:'H股LOF', tq:'sz160717', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.95%'},
  {code:'501311', ocode:'501311', name:'新经济港通LOF', tq:'sh501311', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.90%'},
  {code:'501301', ocode:'501301', name:'香港大盘LOF', tq:'sh501301', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.90%'},
  {code:'164705', ocode:'164705', name:'恒生LOF', tq:'sz164705', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.00%'},
  {code:'161831', ocode:'161831', name:'恒生国企LOF', tq:'sz161831', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.20%'},
  {code:'501305', ocode:'501305', name:'港股高股息LOF', tq:'sh501305', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.60%'},
  {code:'160924', ocode:'160924', name:'恒生指数LOF', tq:'sz160924', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.20%'},
  {code:'501025', ocode:'501025', name:'香港银行LOF', tq:'sh501025', category:'hk', quota:'开放', fee:'1.20%', rfee:'0.90%'},
  // A股行业LOF
  {code:'161226', ocode:'161226', name:'国投白银LOF', tq:'sz161226', category:'cm', quota:'暂停', fee:'1.50%', rfee:'0.50%'},
  {code:'161217', ocode:'161217', name:'国投瑞银中证上游资源产业指数证券投资基金(LOF)', tq:'sz161217', category:'cm', quota:'开放', fee:'1.50%', rfee:'0.50%'},
  {code:'161715', ocode:'161715', name:'招商中证大宗商品股票指数证券投资基金(LOF)', tq:'sz161715', category:'cm', quota:'开放', fee:'1.50%', rfee:'0.50%'},
  {code:'161725', ocode:'161725', name:'招商中证白酒LOF', tq:'sz161725', category:'cn', quota:'开放', fee:'1.50%', rfee:'0.50%'},
  {code:'161032', ocode:'161032', name:'富国中证煤炭指数LOF', tq:'sz161032', category:'cn', quota:'开放', fee:'1.50%', rfee:'0.50%'}
];

// 基准指数
const BENCH = {
  // 美股 — usIXIC=纳指, usINX=标普
  '161127': 'usXBI',    // 标普生物科技
  '164906': 'usKWEB',   // 中概互联网
  '501312': [{tq:'usQQQ',w:0.8},{tq:'hkHSTECH',w:0.1},{tq:'sh000985',w:0.1}],   // 海外科技LOF
  '164824': 'usINDA',   // 印度基金LOF
  '160644': 'usKWEB',  // 港美互联网LOF
  '162415': 'usXLY',    // 美国消费
  '161126': 'usRSPH',   // 标普医疗保健LOF
  '161128': 'usXLK',    // 标普信息科技
  '161125': 'usINX',    // 标普500
  '161130': 'usQQQ',    // 纳斯达克100
  '501300': 'usAGG',    // 美元债
  '160140': 'usRWR',    // 美国REIT精选LOF
  '501225': 'usSMH',    // 全球芯片LOF
  // 商品
  '160216': [{tq:'usSGOL',w:0.234},{tq:'usGLD',w:0.193},{tq:'usGLDM',w:0.154},{tq:'usUSO',w:0.153},{tq:'usSLV',w:0.151},{tq:'usCPER',w:0.143},{tq:'usXOP',w:0.038}],  // 国泰商品
  '161116': 'sh518880',  // 黄金主题
  '164701': 'usGLD',   // 黄金LOF
  '165513': 'usGLD',   // 中信保诚商品LOF
  '160719': 'sh518880',  // 嘉实黄金
  '161815': [{tq:'usGLD',w:0.171},{tq:'usIAU',w:0.168},{tq:'usAAAU',w:0.144},{tq:'usSGOL',w:0.139},{tq:'usBCI',w:0.122},{tq:'usCOMT',w:0.095},{tq:'usUSO',w:0.051},{tq:'usBNO',w:0.044},{tq:'usSLV',w:0.024},{tq:'usCPER',w:0.053}],  // 抗通胀LOF
  '163208': 'usXLE',   // 全球油气能源
  '501018': [{tq:'usUSO',w:0.6},{tq:'usBNO',w:0.4}],  // 南方原油
  '161129': 'usUSO',   // 原油LOF易方达
  '160723': 'usUSO',   // 嘉实原油
  '162719': 'usXOP',   // 石油LOF
  '162411': 'usXOP',   // 华宝油气
  '160416': 'usIXC',   // 石油基金
  // 港股
  '501303': 'hkHSMI',  // 广发恒生综合中型股LOF
  '161124': 'hkHSSI',   // 易方达港股小盘LOF
  '160322': 'hkHSCI', // 华夏港股通精选LOF
  '501021': 'hkHSTECH', // 香港中小LOF
  '501310': [{tq:'sh000300',w:0.5},{tq:'hkHSCEI',w:0.5}], // 价值基金LOF
  '501302': 'hkHSI',
  '501307': 'csi930917', // 银河高股息LOF
  '501306': 'csi930914', // 港股高股息LOFC
  '160717': 'hkHSCEI', // H股LOF
  '501311': 'hkHSTECH', // 新经济港通LOF
  '501301': 'hkHSCEI', // 香港大盘LOF
  '164705': 'hkHSI',
  '161831': 'hkHSCEI',  // 恒生国企LOF
  '501305': 'csi930914', // 港股高股息LOF
  '160924': 'hkHSI',
  '501025': 'csi930792', // 香港银行LOF
  // 商品 — 白银
  '161226': 'nf_AG0',  // 国投白银LOF
  // A股行业LOF
  '161217': 'sh000945',  // 国投瑞银中证上游资源产业指数证券投资基金(LOF)
  '161715': 'sh000066',  // 招商中证大宗商品股票指数证券投资基金(LOF)
  '161725': 'sh000852',  // 招商中证白酒LOF
  '161032': 'sz399998'  // 富国中证煤炭指数LOF
};

// 所有腾讯财经代码
const ALL_TQ_CODES = [
  ...FUNDS.map(fund => fund.tq),
  ...Object.values(BENCH).flatMap(bench => Array.isArray(bench) ? bench.map(item => item.tq) : [bench])
];

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

// 通用fetch函数，添加请求头模拟浏览器
async function fetchWithHeaders(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://fund.eastmoney.com/',
    'Connection': 'keep-alive'
  };
  
  try {
    const response = await fetch(url, { headers });
    return response;
  } catch (error) {
    console.error('网络请求失败:', error);
    throw error;
  }
}

// 从东方财富pingzhongdata获取净值数据
async function fetchNavFromPingzhong(fund) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${fund.code}.js?v=${Date.now()}`;
  
  try {
    const response = await fetchWithHeaders(url);
    const text = await response.text();
    
    if (!text || text.trim() === '') {
      console.log(`获取${fund.code}pingzhongdata数据失败: 返回空数据`);
      return null;
    }
    
    // 提取Data_netWorthTrend数据
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
    
    // 尝试提取Data_ACWorthTrend数据
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

// 从东方财富lsjz获取净值数据
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

// 从天天基金获取净值数据
async function fetchNav(fund) {
  const url = `https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`;
  
  try {
    const response = await fetchWithHeaders(url);
    const text = await response.text();
    
    // 检查返回文本是否为空
    if (!text || text.trim() === '') {
      console.log(`获取${fund.code}净值数据失败: 返回空数据`);
      return null;
    }
    
    // 解析JSONP数据
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

// 从东方财富获取净值数据（综合多个接口）
async function fetchNavFromEM(fund) {
  try {
    // 并行获取多个接口的数据
    const [pingzhongResult, lsjzResult, fundgzResult] = await Promise.all([
      fetchNavFromPingzhong(fund),
      fetchNavFromLsjz(fund),
      fetchNav(fund)
    ]);
    
    // 收集所有有效的结果
    const results = [pingzhongResult, lsjzResult, fundgzResult].filter(result => result && result.nav > 0);
    
    if (results.length === 0) {
      return null;
    }
    
    // 按日期排序，取最新的
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

// 加载所有基金的净值数据
async function loadNavs() {
  const BATCH_SIZE = 15;
  let loaded = 0;
  const navData = {};
  
  for (let i = 0; i < FUNDS.length; i += BATCH_SIZE) {
    const batch = FUNDS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (fund) => {
      try {
        // 使用综合数据源获取净值数据
        const result = await fetchNavFromEM(fund);
        if (result && result.nav > 0) {
          console.log(`成功获取${fund.code}净值数据: ${result.nav} (${result.date})`);
          return result;
        }
        
        console.log(`所有API获取${fund.code}净值数据都失败`);
        return null;
      } catch (error) {
        console.error(`获取${fund.code}净值数据失败:`, error);
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
  }
  
  return navData;
}

// 从新浪财经获取基金数据（备用）
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

// 检查溢价率异常
async function checkAbnormalPremium() {
  const threshold = 3; // 3%的阈值
  const abnormalFunds = [];
  
  try {
    console.log('开始获取数据...');
    
    // 并行获取数据
    const [tencentData, eastmoneyData, navData, sinaData] = await Promise.all([
      fetchTencentData(),
      fetchEastmoney(),
      loadNavs(),
      fetchSinaData()
    ]);
    
    console.log('数据获取完成');
    console.log('腾讯财经数据:', Object.keys(tencentData.funds).length, '只基金');
    console.log('新浪财经数据:', Object.keys(sinaData.funds).length, '只基金');
    console.log('净值数据:', Object.keys(navData).length, '只基金');
    
    // 合并指数数据
    const indexData = { ...tencentData.indices, ...eastmoneyData.data };
    console.log('指数数据:', Object.keys(indexData).length, '个指数');
    
    // 合并基金数据（优先使用腾讯财经数据，新浪财经作为备用）
    const allFundsData = { ...sinaData.funds, ...tencentData.funds };
    console.log('合并后基金数据:', Object.keys(allFundsData).length, '只基金');
    
    // 处理基金数据
    console.log('开始处理基金数据...');
    for (const fund of FUNDS) {
      try {
        // 获取场内价格（优先使用腾讯财经，新浪财经作为备用）
        const fundData = allFundsData[fund.tq];
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
        
        if (benchCode) {
          if (Array.isArray(benchCode)) {
            // 处理复合基准指数
            let totalWeight = 0;
            let weightedChange = 0;
            
            for (const bench of benchCode) {
              if (bench.tq && indexData[bench.tq]) {
                weightedChange += indexData[bench.tq] * bench.w;
                totalWeight += bench.w;
              }
            }
            
            if (totalWeight > 0) {
              benchChange = weightedChange / totalWeight;
            }
          } else if (indexData[benchCode]) {
            // 处理单个基准指数
            benchChange = indexData[benchCode];
          }
        }
        
        // 计算预估净值（如果没有指数数据，直接使用最新净值）
        const estimatedNav = navInfo.nav;
        
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
    
    console.log(`处理完成，发现${abnormalFunds.length}只异常基金`);
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