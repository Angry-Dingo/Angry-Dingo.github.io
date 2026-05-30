
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取当前 funds.json
const fundsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/funds.json'), 'utf8'));

// 定义原始 BENCH 和 INDEX_NAMES
const BENCH = {
  '161127': 'usXBI',
  '164906': 'usKWEB',
  '501312': [{tq:'usQQQ',w:0.8},{tq:'hkHSTECH',w:0.1},{tq:'sh000985',w:0.1}],
  '164824': 'usINDA',
  '160644': 'usKWEB',
  '162415': 'usXLY',
  '161126': 'usRSPH',
  '161128': 'usXLK',
  '161125': 'usINX',
  '161130': 'usQQQ',
  '501300': 'usAGG',
  '160140': 'usRWR',
  '501225': 'usSMH',
  '160216': [{tq:'usSGOL',w:0.234},{tq:'usGLD',w:0.193},{tq:'usGLDM',w:0.154},{tq:'usUSO',w:0.153},{tq:'usSLV',w:0.151},{tq:'usCPER',w:0.143},{tq:'usXOP',w:0.038}],
  '161116': 'sh518880',
  '164701': 'usGLD',
  '165513': 'usGLD',
  '160719': 'sh518880',
  '161815': [{tq:'usGLD',w:0.171},{tq:'usIAU',w:0.168},{tq:'usAAAU',w:0.144},{tq:'usSGOL',w:0.139},{tq:'usBCI',w:0.122},{tq:'usCOMT',w:0.095},{tq:'usUSO',w:0.051},{tq:'usBNO',w:0.044},{tq:'usSLV',w:0.024},{tq:'usCPER',w:0.053}],
  '163208': 'usXLE',
  '501018': [{tq:'usUSO',w:0.6},{tq:'usBNO',w:0.4}],
  '161129': 'usUSO',
  '160723': 'usUSO',
  '162719': 'usXOP',
  '162411': 'usXOP',
  '160416': 'usIXC',
  '501303': 'hkHSMI',
  '161124': 'hkHSSI',
  '160322': 'hkHSCI',
  '501021': 'hkHSTECH',
  '501310': [{tq:'sh000300',w:0.5},{tq:'hkHSCEI',w:0.5}],
  '501302': 'hkHSI',
  '501307': 'csi930917',
  '501306': 'csi930914',
  '160717': 'hkHSCEI',
  '501311': 'hkHSTECH',
  '501301': 'hkHSCEI',
  '164705': 'hkHSI',
  '161831': 'hkHSCEI',
  '501305': 'csi930914',
  '160924': 'hkHSI',
  '501025': 'csi930792',
  '161226': 'nf_AG0',
  '161217': 'sh000945',
  '161715': 'sh000066',
  '161725': 'sh000852',
  '161032': 'sz399998',
};

const INDEX_NAMES = {
  'usXBI': '标普生物科技',
  'usKWEB': '中概互联网',
  'usQQQ': '纳斯达克100',
  'hkHSTECH': '恒生科技',
  'sh000985': '中证综合债券',
  'usINDA': '印度ETF',
  'usXLY': '美国消费',
  'usRSPH': '标普医疗保健等权重',
  'usXLK': '标普信息科技',
  'usINX': '标普500',
  'usAGG': '美国综合债券',
  'usRWR': '美国REIT',
  'usSMH': '半导体ETF',
  'usSGOL': '白银ETF',
  'usGLD': '黄金ETF',
  'usGLDM': '黄金ETF',
  'usUSO': '原油ETF',
  'usSLV': '白银ETF',
  'usCPER': '铜ETF',
  'usXOP': '石油天然气上游',
  'sh518880': '黄金ETF',
  'usIAU': '黄金ETF',
  'usAAAU': '黄金ETF',
  'usBCI': '商品ETF',
  'usCOMT': '商品ETF',
  'usBNO': '布伦特原油',
  'usXLE': '能源ETF',
  'usIXC': '全球能源ETF',
  'hkHSMI': '恒生综合中型股',
  'hkHSI': '恒生指数',
  'hkHSCI': '恒生综合指数',
  'sh000300': '沪深300',
  'hkHSCEI': '恒生国企指数',
  'csi930917': '中证沪港深高股息',
  'csi930914': '中证港股通高股息',
  'csi930792': '中证港股通香港银行',
  'nf_AG0': '沪银主连',
  'sh000807': '中证食品饮料',
  'sz399975': '中证全指证券',
  'sz399998': '中证煤炭',
  'sh000852': '中证白酒',
  'sh000066': '上证大宗商品股票指数',
  'sh000945': '中证上游资源产业指数'
};

// 添加 benchmark 字段
fundsJson.funds.forEach(fund => {
  if (BENCH[fund.code]) {
    fund.benchmark = BENCH[fund.code];
    console.log(`✅ ${fund.code}: benchmark added`);
  } else {
    console.log(`❌ ${fund.code}: no benchmark found`);
  }
});

// 更新 indexNames
fundsJson.indexNames = INDEX_NAMES;

// 保存
fs.writeFileSync(path.join(__dirname, 'data/funds.json'), JSON.stringify(fundsJson, null, 2), 'utf8');

console.log('\n✅ Done!');
