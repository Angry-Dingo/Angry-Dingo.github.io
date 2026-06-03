import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FUNDS_JSON_PATH = path.join(__dirname, '../data/funds.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  } catch (e) { return null; }
}

async function httpGet(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      redirect: 'follow'
    });
    return await response.text();
  } catch (error) {
    console.error(`HTTP request failed for ${url}:`, error.message);
    return null;
  }
}

async function fetchSingleQuota(code) {
  try {
    const url = `https://fund.eastmoney.com/${code}.html`;
    const html = await httpGet(url);
    if (!html) return null;

    if (html.match(/暂停申购|暂停大额申购|暂停大额|大额暂停/)) {
      return { limit: 0 };
    }

    let limitMatch = html.match(/申购限额[：:]\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/单笔限额\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/单日累计申购上限\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/单日累计购买上限\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/单个投资者单日累计申购金额上限为[^<]*?([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/单日累计购买上限\s*([\d,.]+)\s*元(?!万)/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1].replace(/,/g, ''));
      if (limit > 0) return { limit };
    }

    if (html.match(/限大额|大额限购/)) return { limit: -1 };

    if (html.match(/开放申购/)) return { limit: null };

  } catch (e) {
    console.log(`Detail page request failed for ${code}: ${e.message}`);
  }
  return null;
}

function formatQuotaText(limit) {
  if (limit === 0) return '暂停';
  if (limit === null) return '开放';
  if (limit === -1) return '限大额';
  if (limit >= 100000000) return `限${(limit / 100000000).toFixed(0)}亿`;
  if (limit >= 10000) return `限${(limit / 10000).toFixed(0)}万`;
  if (limit >= 1000) return `限${(limit / 1000).toFixed(0)}千`;
  return `限${limit}`;
}

function formatQuotaNumber(quotaText) {
  if (!quotaText || quotaText === '开放') return null;
  if (quotaText === '暂停') return 0;
  if (quotaText === '限大额') return -1;

  const match = quotaText.match(/限([\d.]+)(亿|万|千)?/);
  if (!match) return null;

  let limit = parseFloat(match[1]);
  const unit = match[2];

  if (unit === '亿') return limit * 100000000;
  if (unit === '万') return limit * 10000;
  if (unit === '千') return limit * 1000;
  return limit;
}

async function sendFeishuNotification(message) {
  const webhookUrl = process.env.FEISHU_WEBHOOK;
  if (!webhookUrl) {
    console.log('飞书Webhook未配置，跳过通知');
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: message }
      })
    });
  } catch (e) {
    console.log(`飞书通知发送失败: ${e.message}`);
  }
}

async function updateFundsData() {
  console.log('[LOG] === 开始数据更新任务 ===');

  const dataContent = fs.readFileSync(FUNDS_JSON_PATH, 'utf-8');
  const fundsData = JSON.parse(dataContent);
  console.log(`[LOG] 加载 ${fundsData.funds.length} 只基金`);

  const BATCH_SIZE = 3;
  const navData = {};
  const quotaData = {};

  for (let i = 0; i < fundsData.funds.length; i += BATCH_SIZE) {
    const batch = fundsData.funds.slice(i, i + BATCH_SIZE);
    console.log(`[LOG] 处理第 ${Math.floor(i/BATCH_SIZE) + 1} 批`);

    const navResults = await Promise.all(batch.map(f => fetchSingleNav(f.code)));
    const quotaResults = await Promise.all(batch.map(f => fetchSingleQuota(f.code)));

    navResults.forEach((r, idx) => { if (r) navData[batch[idx].code] = r; });
    quotaResults.forEach((r, idx) => { if (r) quotaData[batch[idx].code] = r; });

    await sleep(1500);
  }

  const quotaChanges = [];
  const originalQuota = {};
  fundsData.funds.forEach(fund => {
    originalQuota[fund.code] = fund.quota;
  });

  for (const fund of fundsData.funds) {
    const navInfo = navData[fund.code];
    if (navInfo && navInfo.nav > 0) {
      fund.officialNav = navInfo.nav;
      fund.navDate = navInfo.date;
    }

    const quotaInfo = quotaData[fund.code];
    if (quotaInfo) {
      const newQuota = formatQuotaText(quotaInfo.limit);

      if (newQuota !== originalQuota[fund.code]) {
        quotaChanges.push({
          code: fund.code,
          name: fund.name,
          oldQuota: originalQuota[fund.code] || '未知',
          newQuota: newQuota
        });
      }
      fund.quota = newQuota;
      fund.purchaseLimit = quotaInfo.limit;
      fund.quotaUpdatedAt = new Date().toISOString();
    }
  }

  fundsData.updatedAt = new Date().toISOString();

  fs.writeFileSync(FUNDS_JSON_PATH, JSON.stringify(fundsData, null, 2), 'utf-8');
  console.log('[LOG] funds.json 已更新');

  console.log(`[LOG] 总计获取 ${Object.keys(quotaData).length} 只基金申购状态`);
  console.log(`[LOG] 状态变化 ${quotaChanges.length} 只基金`);

  if (quotaChanges.length > 0) {
    let message = `【LOF基金申购状态更新】\n\n`;
    message += `更新时间: ${new Date().toLocaleString('zh-CN')}\n`;
    message += `更新基金数: ${fundsData.funds.length}\n`;
    message += `状态变化: ${quotaChanges.length} 只\n\n`;
    message += `---\n\n`;

    quotaChanges.forEach(f => {
      message += `${f.name} (${f.code})\n`;
      message += `  申购限额: ${f.oldQuota} → ${f.newQuota}\n\n`;
    });

    console.log('\n发送飞书通知...');
    await sendFeishuNotification(message);
    console.log('通知已发送');
  } else {
    console.log('\n无申购状态变化，无需发送通知');
  }

  return { totalCount: Object.keys(quotaData).length, changes: quotaChanges };
}

updateFundsData().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});
