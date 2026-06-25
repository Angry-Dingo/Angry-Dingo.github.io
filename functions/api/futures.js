// CF Pages Function - 沪银主连期货数据服务端代理
// 浏览器端无法直连东财期货API（CORS限制）和Sina期货API（Referer限制）
// 此函数从服务端获取数据，无CORS/Referer限制

export async function onRequest(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  };

  // 优先尝试东方财富期货行情API
  // 沪银主连：上期所market=113, code=agm
  try {
    const emRes = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=113.agm&fields=f43,f170,f3,f14&_=${Date.now()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (emRes.ok) {
      const emData = await emRes.json();
      if (emData && emData.data) {
        const chg = emData.data.f3 !== undefined ? emData.data.f3 : null;
        if (chg !== null) {
          return new Response(JSON.stringify({
            nf_AG0: chg,
            source: 'eastmoney',
            time: emData.data.f14 || ''
          }), { headers });
        }
      }
    }
  } catch (e) {
    console.error('[futures-proxy] 东方财富期货API请求失败:', e.message);
  }

  // 备用：从新浪财经获取期货数据（服务端无Referer限制）
  try {
    const sinaRes = await fetch('https://hq.sinajs.cn/list=nf_AG0', {
      headers: { 'Referer': 'https://finance.sina.com.cn' }
    });
    const text = await sinaRes.text();
    // sina格式: var hq_str_nf_AG0="沪银主连,09:44:18,14090,14472,13560,14896,13855,13954,13956,394929,251742,...
    // parts[5]=昨结算, parts[6]=当前价, parts[10]=昨收(备选)
    const match = text.match(/hq_str_nf_AG0="([^"]+)"/);
    if (match) {
      const parts = match[1].split(',');
      const currentPrice = parseFloat(parts[6]);
      let prevClose = parseFloat(parts[5]); // 昨结算
      if (!prevClose || prevClose <= 0) prevClose = parseFloat(parts[10]); // 备选昨收
      if (currentPrice > 0 && prevClose > 0) {
        const chg = (currentPrice - prevClose) / prevClose * 100;
        return new Response(JSON.stringify({
          nf_AG0: parseFloat(chg.toFixed(2)),
          source: 'sina',
          time: parts[1] || ''
        }), { headers });
      }
    }
  } catch (e) {
    console.error('[futures-proxy] 新浪期货API请求失败:', e.message);
  }

  return new Response(JSON.stringify({ nf_AG0: null, source: 'none' }), { headers });
}