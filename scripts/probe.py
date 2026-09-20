#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
单源调试工具：直接打一个 URL，看状态码、长度、正文片段和页面里的链接模式。
用来给 fetch_hot.py 里的某个抓取器定位接口 / 修正正则。

用法：
    python scripts/probe.py <url>
    python scripts/probe.py <url> --referer https://example.com/ --head 3000
    python scripts/probe.py <url> --mobile
"""
import collections
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_hot import http_get, strip_tags, UA_MOBILE  # noqa: E402


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    url = argv[1]
    head = 1200
    headers = {}
    for i, a in enumerate(argv):
        if a == '--head' and i + 1 < len(argv):
            head = int(argv[i + 1])
        if a == '--referer' and i + 1 < len(argv):
            headers['Referer'] = argv[i + 1]
        if a == '--mobile':
            headers['User-Agent'] = UA_MOBILE

    print(f'GET {url}')
    try:
        txt = http_get(url, headers=headers or None, retries=1)
    except Exception as e:  # noqa: BLE001
        print('ERR', type(e).__name__, e)
        return 1

    print(f'长度: {len(txt)} 字符')
    stripped = txt.lstrip()
    if stripped[:1] in ('{', '['):
        print('--- 看起来是 JSON ---')
        print(txt[:head])
        return 0

    print(f'--- 正文片段（前 {head} 字符）---')
    print(re.sub(r'\s+', ' ', txt[:head]))

    hrefs = re.findall(r'href="([^"#]{6,140})"', txt)
    if hrefs:
        print('\n--- 出现最多的 href 模式（数字已归一为 N）---')
        cnt = collections.Counter(re.sub(r'\d+', 'N', h) for h in hrefs)
        for pat, n in cnt.most_common(12):
            print(f'  {n:5d}  {pat}')

    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
