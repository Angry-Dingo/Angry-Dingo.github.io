import fetch from 'node-fetch';

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

async function testFetchQuota(code) {
  const html = await httpGet(`https://fund.eastmoney.com/${code}.html`);
  
  console.log('--- 501312 页面关键词 ---');
  const keywords = ['暂停申购', '暂停大额', '限大额', '申购限额', '单笔限额', '单日累计', '开放申购'];
  keywords.forEach(k => {
    if (html.includes(k)) console.log(`✅ 找到: ${k}`);
  });
  
  console.log('\n--- 尝试匹配限额 ---');
  
  const patterns = [
    /申购限额[：:]\s*([\d.]+)\s*万元?/,
    /单笔限额\s*([\d.]+)\s*万元?/,
    /单日累计申购上限\s*([\d.]+)\s*万元?/,
    /单日累计购买上限\s*([\d.]+)\s*万元?/,
    /单个投资者单日累计申购金额上限为[^<]*?([\d.]+)\s*万元?/,
    /单日累计购买上限\s*([\d,.]+))\s*元(?!万)/
  ];
  
  patterns.forEach((pattern, idx) => {
    const match = html.match(pattern);
    if (match) {
      console.log(`✅ 匹配成功 (pattern ${idx}):`, match[0]);
    }
  });
  
  if (html.match(/暂停申购|暂停大额申购|暂停大额|大额暂停/)) {
    console.log('--- 结果: 暂停申购 (limit: 0) ---');
  } else if (html.match(/限大额|大额限购/)) {
    console.log('--- 结果: 限大额 (limit: -1) ---');
  } else if (html.match(/开放申购/)) {
    console.log('--- 结果: 开放申购 (limit: null) ---');
  } else {
    console.log('--- 结果: 未知 ---');
  }
}

testFetchQuota('501312').catch(console.error);
