import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FUNDS_JSON_PATH = path.join(__dirname, '../data/funds.json');

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

async function fetchQuotaFromDetail(code) {
  try {
    const url = `https://fund.eastmoney.com/${code}.html`;
    const html = await httpGet(url);
    if (!html) return null;

    // 查找暂停申购
    if (html.match(/暂停申购|暂停大额申购|暂停大额|大额暂停/)) {
      return { limit: 0, source: 'detail_page_suspend' };
    }

    // 查找申购限额
    // 格式1：申购限额：10万元
    let limitMatch = html.match(/申购限额[：:]\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) {
        return { limit: limit * 10000, source: 'detail_page' };
      }
    }

    // 格式2：单笔限额10万
    limitMatch = html.match(/单笔限额\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) {
        return { limit: limit * 10000, source: 'detail_page' };
      }
    }

    // 格式3：单日累计申购上限10万元
    limitMatch = html.match(/单日累计申购上限\s*([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) {
        return { limit: limit * 10000, source: 'detail_page' };
      }
    }

    // 格式4：单个投资者单日累计申购金额上限为10万元
    limitMatch = html.match(/单个投资者单日累计申购金额上限为[^<]*?([\d.]+)\s*万元?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) {
        return { limit: limit * 10000, source: 'detail_page' };
      }
    }

    // 查找申购状态是开放
    if (html.match(/开放申购/)) {
      return { limit: null, source: 'detail_page_open' };
    }

  } catch (e) {
    console.log(`Detail page request failed for ${code}: ${e.message}`);
  }
  return null;
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

function formatQuotaText(limit) {
  if (limit === 0) return '暂停';
  if (limit === null) return '开放';
  if (limit >= 100000000) return `限${(limit / 100000000).toFixed(0)}亿`;
  if (limit >= 10000) return `限${(limit / 10000).toFixed(0)}万`;
  if (limit >= 1000) return `限${(limit / 1000).toFixed(0)}千`;
  return `限${limit}`;
}

function formatQuotaNumber(quotaText) {
  if (!quotaText || quotaText === '开放') return null;
  if (quotaText === '暂停') return 0;

  const match = quotaText.match(/限([\d.]+)(亿|万|千)?/);
  if (!match) return null;

  let limit = parseFloat(match[1]);
  const unit = match[2];

  if (unit === '亿') return limit * 100000000;
  if (unit === '万') return limit * 10000;
  if (unit === '千') return limit * 1000;
  return limit;
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

  for (let i = 0; i < funds.length; i++) {
    const fund = funds[i];
    const code = fund.code;

    console.log(`[${i + 1}/${funds.length}] 正在获取 ${fund.name} (${code}) 的申购状态...`);

    const result = await fetchQuotaFromDetail(code);

    if (result) {
      const oldQuotaText = fund.quota || '开放';
      const oldLimit = formatQuotaNumber(oldQuotaText);
      const newLimit = result.limit;

      const newQuotaText = formatQuotaText(newLimit);

      if (oldLimit !== newLimit) {
        changedFunds.push({
          name: fund.name,
          code: code,
          oldQuota: oldQuotaText,
          newQuota: newQuotaText,
          source: result.source
        });
        fund.quota = newQuotaText;
        fund.purchaseLimit = newLimit;
        fund.quotaUpdatedAt = new Date().toISOString();
        console.log(`  → 更新: ${oldQuotaText} → ${newQuotaText}`);
      } else {
        console.log(`  → 无变化`);
      }
    } else {
      console.log(`  → 未能获取数据`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  fundsData.updatedAt = new Date().toISOString();
  fs.writeFileSync(FUNDS_JSON_PATH, JSON.stringify(fundsData, null, 2));

  console.log(`\n更新完成！`);
  console.log(`状态变化: ${changedFunds.length} 只`);

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
