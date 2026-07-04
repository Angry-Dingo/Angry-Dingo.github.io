import json

with open('data/fund_holdings_regression.json','r') as f:
    data = json.load(f)

results = data.get('results',{})
print(f"更新日期: {data.get('updatedAt','')}")
print(f"基金总数: {data.get('totalFunds',0)}")
print()

# Map code to name from funds.json
with open('data/funds.json','r') as f:
    funds_data = json.load(f)
fund_names = {f['code']: f.get('name','') for f in funds_data.get('funds',[])}

# Map code to category from update_holdings.js problem funds
categories = {
    'hk': '港股', 'us': '美股', 'cn': 'A股', 'cm': '商品'
}
fund_cats = {
    '501303':'hk','161124':'hk','501021':'hk','501310':'hk','501302':'hk',
    '501307':'hk','501306':'hk','160717':'hk','501311':'hk','501301':'hk',
    '164705':'hk','161831':'hk','501305':'hk','160924':'hk','501025':'hk','160322':'hk',
    '160644':'hk','161126':'us',
    '161725':'cn','161032':'cn',
    '161217':'cm','161715':'cm'
}

print(f"{'代码':>6} {'名称':20s} {'类别':4s} {'状态':8s} {'样本':>5s} {'可用股数':>6s} {'回归R²':>8s} {'约束R²':>8s} {'主要持仓(前3)':40s}")
print("="*110)

for code in sorted(results.keys()):
    r = results[code]
    name = fund_names.get(code, '')
    cat = categories.get(fund_cats.get(code,''), '')
    status = r.get('status','')
    samples = r.get('samples',0)
    avail = r.get('availableStocks',0)
    total = r.get('totalStocks',0)
    reg_r2 = r.get('regressionR2',0)
    con_r2 = r.get('constrainedR2',0)
    
    # Top 3 holdings by constrained weight
    simp = r.get('simpleWeights',[])
    if simp:
        sorted_by_weight = sorted([s for s in simp if s.get('constrainedWeight',0) > 0.001 or s.get('simpleWeight',0) > 0.001],
                                  key=lambda x: max(x.get('constrainedWeight',0), x.get('simpleWeight',0)), reverse=True)
        top3 = sorted_by_weight[:3]
        top3_str = ', '.join([f"{s['name']}({max(s.get('constrainedWeight',0), s.get('simpleWeight',0))*100:.0f}%)" for s in top3])
    else:
        top3_str = 'N/A'
    
    print(f"{code:>6} {name[:18]:20s} {cat:4s} {status:8s} {samples:>5d} {avail:>3d}/{total:<2d} {reg_r2*100:>7.1f}% {con_r2*100:>7.1f}% {top3_str[:40]:40s}")

print()
print("R²说明: 回归R²=OLS回归拟合度, 约束R²=NNLS非负约束加权回归拟合度")
print("可用股数: 能在腾讯/东方财富实时获取行情的前十大持仓数量")