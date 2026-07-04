// CF Pages Function - 沪银主连期货数据服务端代理
// 浏览器端无法直连东财期货API（CORS限制）和Sina期货API（Referer限制）
// 此函数从服务端获取数据，无CORS/Referer限制
// 支持多数据源自动故障切换

export async function onRequest(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  };

  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.AGM&fields=f43,f170,f3,f14&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data) {
        const chg = emData.data.f3;
        if (chg !== undefined && chg !== null) {
          return new Response(JSON.stringify({ nf_AG0: chg, source: 'eastmoney_A', time: emData.data.f14 || '', price: emData.data.f43 || 0 }), { headers });
        }
      }
    }
  } catch (e) {}

  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.agm&fields=f43,f170,f3,f14&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data) {
        const chg = emData.data.f3;
        if (chg !== undefined && chg !== null) {
          return new Response(JSON.stringify({ nf_AG0: chg, source: 'eastmoney_B', time: emData.data.f14 || '', price: emData.data.f43 || 0 }), { headers });
        }
      }
    }
  } catch (e) {}

  try {
    const sinaRes = await fetch('https://hq.sinajs.cn/list=nf_AG0', {
      headers: { 'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await sinaRes.text();
    const match = text.match(/hq_str_nf_AG0="([^"]+)"/);
    if (match) {
      const parts = match[1].split(',');
      const currentPrice = parseFloat(parts[6]);
      let prevClose = parseFloat(parts[5]);
      if (!prevClose || prevClose <= 0) prevClose = parseFloat(parts[10]);
      if (currentPrice > 0 && prevClose > 0) {
        const chg = (currentPrice - prevClose) / prevClose * 100;
        return new Response(JSON.stringify({ nf_AG0: parseFloat(chg.toFixed(2)), source: 'sina', time: parts[1] || '', price: currentPrice, prevClose: prevClose }), { headers });
      }
    }
  } catch (e) {}

  return new Response(JSON.stringify({ nf_AG0: null, source: 'all_failed' }), { headers });
}