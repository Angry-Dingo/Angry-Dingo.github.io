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

async function fetchSingleQuota(code) {
  try {
    const res = await fetch(`https://fund.eastmoney.com/${code}.html`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'http://fund.eastmoney.com/' }
    });
    const html = await res.text();
    let result = null;
    let m = html.match(/单日累计购买上限\s*([\d,.]+)\s*元(?!万)/);
    if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')), unit: '元' };
    if (!result) {
      m = html.match(/单日累计购买上限\s*([\d,.]+)\s*万元/);
      if (m) result = { limit: parseFloat(m[1].replace(/,/g, '')) * 10000, unit: '元' };
    }
    if (!result && html.match(/限大额|大额限购/)) result = { limit: -1, status: '限大额' };
    if (!result && html.match(/暂停申购/)) result = { limit: 0 };
    if (!result && html.match(/开放申购/)) result = { limit: null };
    return result;
  } catch (e) { return null; }
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
      let newQuota = null;
      if (quotaInfo.limit === 0) newQuota = '暂停';
      else if (quotaInfo.limit === null) newQuota = '开放';
      else if (quotaInfo.limit === -1) newQuota = '限大额';
      else if (quotaInfo.limit > 0) {
        if (quotaInfo.limit >= 10000) {
          const wan = quotaInfo.limit / 10000;
          newQuota = `限额${wan % 1 === 0 ? wan.toFixed(0) : wan.toFixed(2)}万`;
        } else {
          newQuota = `限额${quotaInfo.limit.toFixed(0)}元`;
        }
      }

      if (newQuota !== null && newQuota !== originalQuota[fund.code]) {
        quotaChanges.push({
          code: fund.code,
          name: fund.name,
          oldQuota: originalQuota[fund.code] || '未知',
          newQuota: newQuota
        });
      }
      fund.quota = newQuota;
    }
  }

  fundsData.updatedAt = new Date().toISOString();

  fs.writeFileSync(FUNDS_JSON_PATH, JSON.stringify(fundsData, null, 2), 'utf-8');
  console.log('[LOG] funds.json 已更新');

  console.log(`[LOG] 总计获取 ${Object.keys(quotaData).length} 只基金申购状态`);
  console.log(`[LOG] 状态变化 ${quotaChanges.length} 只基金`);

  return { totalCount: Object.keys(quotaData).length, changes: quotaChanges };
}

updateFundsData().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});
