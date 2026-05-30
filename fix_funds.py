#!/usr/bin/env python3
import json
import subprocess

# 从当前文件读取 47 只基金
with open('data/funds.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 从 git 历史获取原始 BENCH 和 INDEX_NAMES
git_output = subprocess.run(['git', 'show', '3eed3bf:index.html'], capture_output=True, text=True).stdout

# 提取 BENCH 部分
bench_start = git_output.find("const BENCH = {")
bench_end = git_output.find("};", bench_start) + 2
bench_str = git_output[bench_start:bench_end]
# 清理 JS 注释
import re
bench_str = re.sub(r'//.*$', '', bench_str, flags=re.MULTILINE)
bench_str = re.sub(r',\s*}', '}', bench_str)
# 执行 JS
import execjs
bench_dict = execjs.eval(bench_str.replace('const BENCH = ', ''))

# 提取 INDEX_NAMES
index_start = git_output.find("const INDEX_NAMES = {")
index_end = git_output.find("};", index_start) + 2
index_str = git_output[index_start:index_end]
index_str = re.sub(r'//.*$', '', index_str, flags=re.MULTILINE)
index_names = execjs.eval(index_str.replace('const INDEX_NAMES = ', ''))

# 给每只基金添加 benchmark 字段
for fund in data['funds']:
    if fund['code'] in bench_dict:
        fund['benchmark'] = bench_dict[fund['code']]
        print(f"{fund['code']}: ✓ benchmark added")
    else:
        print(f"{fund['code']}: ✗ no benchmark found")

# 更新 indexNames
data['indexNames'] = index_names

# 保存
with open('data/funds.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("\n✅ Done!")
