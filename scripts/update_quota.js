import fs from 'fs';
import path from 'path';
import https from 'https';
import { URL } from 'url';

const FUNDS_JSON_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/funds.json');

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const options = new URL(urlStr);
    const reqOptions = {
      hostname: options.hostname,
      path: options.pathname + options.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    
    https.get(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function fetchQuotaFromAPI(code) {
  try {
    const apiUrl = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
    const data = await httpGet(apiUrl);
    
    const match = data.match(/purchaseLimit.*?(\d+\.?\d*)/);
    if (match && match[1]) {
      const limit = parseFloat(match[1]);
      if (limit > 0) {
        return { limit, source: 'pingzhongdata' };
      }
    }
    
    const minPurchaseMatch = data.match(/minPurchase.*?(\d+\.?\d*)/);
    if (minPurchaseMatch && minPurchaseMatch[1]) {
      const limit = parseFloat(minPurchaseMatch[1]);
      if (limit > 0) {
        return { limit, source: 'pingzhongdata_min' };
      }
    }
  } catch (e) {
    console.log(`API request failed for ${code}: ${e.message}`);
  }
  return null;
}

async function fetchQuotaFromDetail(code) {
  try {
    const detailUrl = `https://fund.eastmoney.com/${code}.html`;
    const html = await httpGet(detailUrl);
    
    const limitMatch = html.match(/申购限额.*?(\d+\.?\d*)\s*万/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) {
        return { limit: limit * 10000, source: 'detail_page' };
      }
    }
    
    const limitMatch2 = html.match(/单个投资者单日累计申购金额上限为.*?(\d+\.?\d*)\s*(万|亿)/);
    if (limitMatch2 && limitMatch2[1] && limitMatch2[2]) {
      let limit = parseFloat(limitMatch2[1]);
      if (limitMatch2[2] === '亿') {
        limit = limit * 100000000;
      } else {
        limit = limit * 10000;
      }
      if (limit > 0) {
        return { limit, source: 'detail_page' };
      }
    }
    
    const suspendMatch = html.match(/暂停申购|暂停大额申购/);
    if (suspendMatch) {
      return { limit: 0, source: 'detail_page_suspend' };
    }
  } catch (e) {
    console.log(`Detail page request failed for ${code}: ${e.message}`);
  }
  return null;
}

async function fetchQuotaFromList(code) {
  try {
    const listUrl = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&letter=&gsid=&text=&sort=zdf,desc&page=1,1000&dt=1672531200000&atfc=&onlySale=0`;
    const data = await httpGet(listUrl);
    
    const fundMatch = data.match(new RegExp(`\"${code}\".*?purchaseLimit.*?:(\\d+)`));
    if (fundMatch && fundMatch[1]) {
      const limit = parseFloat(fundMatch[1]);
      if (limit > 0) {
        return { limit, source: 'list_api' };
      }
    }
  } catch (e) {
    console.log(`List API request failed for ${code}: ${e.message}`);
  }
  return null;
}

async function getFundQuota(code) {
  const results = await Promise.all([
    fetchQuotaFromAPI(code),
    fetchQuotaFromDetail(code),
    fetchQuotaFromList(code)
  ]);
  
  const validResults = results.filter(r => r !== null);
  
  if (validResults.length === 0) {
    return null;
  }
  
  validResults.sort((a, b) => {
    const sourcePriority = {
      'detail_page': 3,
      'detail_page_suspend': 4,
      'pingzhongdata': 2,
      'pingzhongdata_min': 1,
      'list_api': 0
    };
    return sourcePriority[b.source] - sourcePriority[a.source];
  });
  
  return validResults[0];
}

async function sendFeishuNotification(message) {
  const webhookUrl = process.env.FEISHU_WEBHOOK;
  if (!webhookUrl) {
    console.log('飞书Webhook未配置，跳过通知');
    return;
  }
  
  try {
    const payload = JSON.stringify({
      msg_type: 'text',
      content: {
        text: message
      }
    });
    
    const options = new URL(webhookUrl);
    const reqOptions = {
      hostname: options.hostname,
      path: options.pathname + options.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch (e) {
    console.log(`飞书通知发送失败: ${e.message}`);
  }
}

function formatQuota(limit) {
  if (limit === 0) return '暂停申购';
  if (limit >= 100000000) return `${(limit / 100000000).toFixed(2)}亿`;
  if (limit >= 10000) return `${(limit / 10000).toFixed(2)}万`;
  return `${limit}元`;
}

async function main() {
  console.log('开始更新基金申购状态...');
  
  if (!fs.existsSync(FUNDS_JSON_PATH)) {
    console.error(`基金数据文件不存在: ${FUNDS_JSON_PATH}`);
    return;
  }
  
  const fundsData = JSON.parse(fs.readFileSync(FUNDS_JSON_PATH, 'utf-8'));
  const funds = fundsData.funds || [];
  
  console.log(`共 ${funds.length} 只基金需要更新`);
  
  const changedFunds = [];
  const unchangedFunds = [];
  
  for (let i = 0; i < funds.length; i++) {
    const fund = funds[i];
    const code = fund.code;
    
    console.log(`[${i + 1}/${funds.length}] 正在获取 ${fund.name} (${code}) 的申购状态...`);
    
    const result = await getFundQuota(code);
    
    if (result) {
      const oldQuota = fund.purchaseLimit;
      const newQuota = result.limit;
      
      if (oldQuota !== newQuota) {
        changedFunds.push({
          name: fund.name,
          code: code,
          oldQuota: formatQuota(oldQuota),
          newQuota: formatQuota(newQuota),
          source: result.source
        });
        fund.purchaseLimit = newQuota;
        fund.quotaUpdatedAt = new Date().toISOString();
      } else {
        unchangedFunds.push(fund.name);
      }
    } else {
      console.log(`无法获取 ${fund.name} (${code}) 的申购状态`);
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  fundsData.updatedAt = new Date().toISOString();
  fs.writeFileSync(FUNDS_JSON_PATH, JSON.stringify(fundsData, null, 2));
  
  console.log(`\n更新完成！`);
  console.log(`状态变化: ${changedFunds.length} 只`);
  console.log(`状态不变: ${unchangedFunds.length} 只`);
  
  if (changedFunds.length > 0) {
    let message = `【LOF基金申购状态更新】\n\n`;
    message += `更新时间: ${new Date().toLocaleString('zh-CN')}\n`;
    message += `更新基金数: ${funds.length}\n`;
    message += `状态变化: ${changedFunds.length} 只\n\n`;
    message += `---\n\n`;
    
    changedFunds.forEach(f => {
      message += `${f.name} (${f.code})\n`;
      message += `  申购限额: ${f.oldQuota} → ${f.newQuota}\n\n`;
    });
    
    console.log('\n发送飞书通知...');
    await sendFeishuNotification(message);
    console.log('通知已发送');
  } else {
    console.log('\n无申购状态变化，无需发送通知');
  }
}

main().catch(err => {
  console.error('更新失败:', err);
  process.exit(1);
});