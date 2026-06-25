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

  // 数据源1：东方财富stock API（尝试大写secid=113.AGM）
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
          return new Response(JSON.stringify({
            nf_AG0: chg,
            source: 'eastmoney_A',
            time: emData.data.f14 || '',
            price: emData.data.f43 || 0
          }), { headers });
        }
      }
    }
  } catch (e) {}

  // 数据源2：东方财富stock API（小写secid=113.agm）
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
          return new Response(JSON.stringify({
            nf_AG0: chg,
            source: 'eastmoney_B',
            time: emData.data.f14 || '',
            price: emData.data.f43 || 0
          }), { headers });
        }
      }
    }
  } catch (e) {}

  // 数据源3：新浪财经期货数据（服务端无Referer限制）
  try {
    const sinaRes = await fetch('https://hq.sinajs.cn/list=nf_AG0', {
      headers: { 'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await sinaRes.text();
    // sina格式: var hq_str_nf_AG0="沪银主连,09:44:18,14090,14472,13560,14896,13855,13954,13956,394929,251742,...
    // parts[0]=名称, parts[1]=时间, parts[2]=开盘, parts[3]=最高, parts[4]=最低, parts[5]=昨结算
    // parts[6]=当前价, parts[10]=昨收(备选)
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
          time: parts[1] || '',
          price: currentPrice,
          prevClose: prevClose
        }), { headers });
      } else {
        // 数据存在但计算异常，返回原始数据供调试
        return new Response(JSON.stringify({
          nf_AG0: null,
          source: 'sina_raw',
          raw_parts_count: parts.length,
          raw_price: parts[6],
          raw_prevClose_p5: parts[5],
          raw_prevClose_p10: parts[10],
          raw_text: text.substring(0, 300)
        }), { headers });
      }
    } else {
      return new Response(JSON.stringify({
        nf_AG0: null,
        source: 'sina_nomatch',
        raw_text: text.substring(0, 300)
      }), { headers });
    }
  } catch (e) {
    return new Response(JSON.stringify({
      nf_AG0: null,
      source: 'sina_error',
      error: e.message
    }), { headers });
  }
}