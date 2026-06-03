import fetch from 'node-fetch';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://fund.eastmoney.com/' } };
async function httpGet(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { const res = await fetch(url, UA); if (res.ok) { const text = await res.text(); if (text && text.length > 50) return text; } } catch (e) { if (i < retries - 1) console.log(`  [RETRY] ${e.message}`); }
    if (i < retries - 1) await sleep(2000);
  }
  return null;
}
export async function fetchHoldings(code) {
  const text = await httpGet(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&rt=${Date.now()}`);
  if (!text) return null;
  const m = text.match(/content:"([\s\S]*?)",arryear/);
  if (!m) return null;
  const content = m[1];
  if (content.length < 50) return { code, holdings: [], note: 'empty' };
  const dateM = content.match(/截至[：:]\s*<font[^>]*>([^<]+)<\/font>/);
  const reportDate = dateM ? dateM[1].trim() : '';
  const rowMatches = content.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
  if (!rowMatches || rowMatches.length < 2) return { code, holdings: [], note: 'no_table' };
  const holdings = [];
  for (let i = 1; i < rowMatches.length; i++) {
    const cells = rowMatches[i].match(/<td[^>]*>([\s\S]*?)<\/td>/g);
    if (!cells || cells.length < 5) continue;
    const seq = cells[0].replace(/<[^>]+>/g, '').trim();
    const rawCode = cells[1].replace(/<[^>]+>/g, '').trim();
    const rawName = cells[2].replace(/<[^>]+>/g, '').trim();
    const rawPercent = cells[4].replace(/<[^>]+>/g, '').trim();
    if (!rawCode && !rawName) continue;
    const stockCode = rawCode;
    const stockName = rawName;
    let tq = '', market = '';
    if (/^(60|68)\d{4}$/.test(stockCode)) { tq = 'sh' + stockCode; market = 'cn'; }
    else if (/^(00|30|002)\d{4}$/.test(stockCode)) { tq = 'sz' + stockCode; market = 'cn'; }
    else if (/^\d{5}$/.test(stockCode)) { tq = 'hk' + stockCode; market = 'hk'; }
    else if (/^[A-Z]{1,5}$/.test(stockCode)) { tq = 'us' + stockCode; market = 'us'; }
    const percent = rawPercent.replace('%', '').replace('--', '');
    const pct = percent ? parseFloat(percent) : null;
    holdings.push({ seq: parseInt(seq) || i, code: stockCode, name: stockName, tq, market, percent: pct });
  }
  return { code, reportDate, totalHoldings: holdings.length, holdings };
}
export async function fetchAllProblemHoldings(fundsList) {
  const results = {};
  for (let i = 0; i < fundsList.length; i++) {
    const f = fundsList[i];
    process.stdout.write(`  [${i + 1}/${fundsList.length}] ${f.code} ${f.name}...`);
    const data = await fetchHoldings(f.code);
    if (data && data.holdings && data.holdings.length > 0) { results[f.code] = data; process.stdout.write(` ${data.holdings.length}只持仓 (${data.reportDate})\n`); }
    else if (data && data.note === 'empty') { process.stdout.write(` 无股票持仓\n`); results[f.code] = data; }
    else { process.stdout.write(` ❌ 失败\n`); }
    if (i % 4 === 3) await sleep(2000);
  }
  return results;
}
