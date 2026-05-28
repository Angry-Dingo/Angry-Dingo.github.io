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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return await response.text();
  } catch (error) {
    console.error(`HTTP request failed for ${url}:`, error.message);
    return null;
  }
}

// 先测试一个简单的API
async function testAPI() {
  console.log('测试API连接...');
  const data = await httpGet('https://fund.eastmoney.com/pingzhongdata/161127.js');
  if (data) {
    console.log('✓ API连接成功！数据长度:', data.length);
    // 查找是否有purchaseLimit相关内容
    const hasPurchaseLimit = data.toLowerCase().includes('purchas');
    console.log('包含"purchas"相关内容:', hasPurchaseLimit);
    if (hasPurchaseLimit) {
      console.log('找到的内容:', data.match(/purchase[^;]*?/gi));
    }
  } else {
    console.log('✗ API连接失败');
  }
}

testAPI();
