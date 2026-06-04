import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FUNDS_JSON_PATH = path.join(__dirname, '../data/funds.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchSingleNav(code) {
  // 鏂规1: fundgz瀹炴椂浼扮畻鍑€鍊硷紙浜ゆ槗鏃舵鏈夋晥锛孮DII甯镐负绌猴級
  try {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const text = await httpGet(url);
    
    if (text && text.trim() !== '') {
      const match = text.match(/jsonpgz\(([^)]+)\)/);
      if (match && match[1]) {
        const data = JSON.parse(match[1]);
        const dwjz = data.DWJZ || data.dwjz || data.data?.dwjz;
        const nav = parseFloat(dwjz);
        const date = data.FSRQ || data.fsrq || data.jzrq || data.data?.jzrq || '';
        if (nav > 0) return { nav, date };
      }
    }
  } catch (e) {}

  // 鏂规2: 澶╁ぉ鍩洪噾鍘嗗彶鍑€鍊糀PI锛坒allback锛屽QDII鏈夋晥锛?
  try {
    const text = await httpGet(`https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=1&pageSize=5&startDate=&endDate=`, { Referer: 'https://fund.eastmoney.com/' });
    if (text) {
      const m = text.match(/jQuery[^(]*\(([\s\S]+)\)/);
      if (m) {
        const data = JSON.parse(m[1]);
        if (data.Data?.LSJZList?.length > 0) {
          const latest = data.Data.LSJZList[0];
          const nav = parseFloat(latest.DWJZ);
          if (nav > 0) return { nav, date: latest.FSRQ };
        }
      }
    }
  } catch (e) {}

  return null;
}

async function httpGet(url, extraHeaders = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...extraHeaders
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

    if (html.match(/鏆傚仠鐢宠喘|鏆傚仠澶ч鐢宠喘|鏆傚仠澶ч|澶ч鏆傚仠/)) {
      return { limit: 0 };
    }

    let limitMatch = html.match(/鐢宠喘闄愰[锛?]\s*([\d.]+)\s*涓囧厓?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/鍗曠瑪闄愰\s*([\d.]+)\s*涓囧厓?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/鍗曟棩绱鐢宠喘涓婇檺\s*([\d.]+)\s*涓囧厓?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/鍗曟棩绱璐拱涓婇檺\s*([\d.]+)\s*涓囧厓?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/鍗曚釜鎶曡祫鑰呭崟鏃ョ疮璁＄敵璐噾棰濅笂闄愪负[^<]*?([\d.]+)\s*涓囧厓?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1]);
      if (limit > 0) return { limit: limit * 10000 };
    }

    limitMatch = html.match(/鍗曟棩绱璐拱涓婇檺\s*([\d,.]+)\s*鍏??!涓?/);
    if (limitMatch && limitMatch[1]) {
      const limit = parseFloat(limitMatch[1].replace(/,/g, ''));
      if (limit > 0) return { limit };
    }

    if (html.match(/闄愬ぇ棰潀澶ч闄愯喘/)) return { limit: -1 };

    if (html.match(/寮€鏀剧敵璐?)) return { limit: null };

  } catch (e) {
    console.log(`Detail page request failed for ${code}: ${e.message}`);
  }
  return null;
}

function formatQuotaText(limit) {
  if (limit === 0) return '鏆傚仠';
  if (limit === null) return '寮€鏀?;
  if (limit === -1) return '闄愬ぇ棰?;
  if (limit >= 100000000) return `闄?{(limit / 100000000).toFixed(0)}浜縛;
  if (limit >= 10000) return `闄?{(limit / 10000).toFixed(0)}涓嘸;
  if (limit >= 1000) return `闄?{(limit / 1000).toFixed(0)}鍗僠;
  return `闄?{limit}`;
}

function formatQuotaNumber(quotaText) {
  if (!quotaText || quotaText === '寮€鏀?) return null;
  if (quotaText === '鏆傚仠') return 0;
  if (quotaText === '闄愬ぇ棰?) return -1;

  const match = quotaText.match(/闄?[\d.]+)(浜縷涓噟鍗??/);
  if (!match) return null;

  let limit = parseFloat(match[1]);
  const unit = match[2];

  if (unit === '浜?) return limit * 100000000;
  if (unit === '涓?) return limit * 10000;
  if (unit === '鍗?) return limit * 1000;
  return limit;
}

async function updateFundsData() {
  console.log('[LOG] === 寮€濮嬫暟鎹洿鏂颁换鍔?===');

  const dataContent = fs.readFileSync(FUNDS_JSON_PATH, 'utf-8');
  const fundsData = JSON.parse(dataContent);
  console.log(`[LOG] 鍔犺浇 ${fundsData.funds.length} 鍙熀閲慲);

  const BATCH_SIZE = 3;
  const navData = {};
  const quotaData = {};

  for (let i = 0; i < fundsData.funds.length; i += BATCH_SIZE) {
    const batch = fundsData.funds.slice(i, i + BATCH_SIZE);
    console.log(`[LOG] 澶勭悊绗?${Math.floor(i/BATCH_SIZE) + 1} 鎵筦);

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
          oldQuota: originalQuota[fund.code] || '鏈煡',
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
  console.log('[LOG] funds.json 宸叉洿鏂?);

  console.log(`[LOG] 鎬昏鑾峰彇 ${Object.keys(quotaData).length} 鍙熀閲戠敵璐姸鎬乣);
  console.log(`[LOG] 鐘舵€佸彉鍖?${quotaChanges.length} 鍙熀閲慲);

  if (quotaChanges.length > 0) {
    console.log('\n[LOG] 鐘舵€佸彉鍖栬鎯?');
    quotaChanges.forEach(f => {
      console.log(`  ${f.name} (${f.code}): ${f.oldQuota} 鈫?${f.newQuota}`);
    });
  }

  return { totalCount: Object.keys(quotaData).length, changes: quotaChanges };
}

updateFundsData().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});
