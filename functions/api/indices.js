// CF Pages Function: 代理东方财富指数数据（服务端无CORS限制）
// 浏览器端从本页面站点调用 /api/indices 获取CSI/港股指数涨跌幅

const EM_CODES = [
  ['csi930917', '2.930917'],  // 中证沪港深高股息指数
  ['csi930914', '2.930914'],  // 中证港股通高股息投资指数
  ['csi930792', '2.930792'],  // 中证港股通香港银行指数
  ['sh000985',  '1.000985'],  // 中证综合债券指数
  ['sh000066',  '1.000066'],  // 上证大宗商品股票指数
  ['sh000945',  '1.000945'],  // 中证上游资源产业指数
  ['hkHSMI',    '124.HSMI'],  // 恒生综合中型股指数
  ['hkHSSI',    '124.HSSI'],  // 恒生综合小型股指数
  ['hkHSCI',    '124.HSCI'],  // 恒生综合指数
  ['nf_AG0',    '8.AG888'],   // 沪银主连（上期所白银期货主力合约）
];

export async function onRequest(context) {
  const results = {};
  const times = {};

  await Promise.all(EM_CODES.map(async ([key, secid]) => {
    try {
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f169,f170,f3,f14&_=${Date.now()}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.data) {
        const chg = d.data.f3 !== undefined ? d.data.f3 : ((d.data.f170 || 0) / 100);
        const time = d.data.f14 || '';
        results[key] = chg;
        times[key] = time;
      }
    } catch (e) {
      // 单个指数失败不影响其他指数
    }
  }));

  return new Response(JSON.stringify({ data: results, times }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }
  });
}