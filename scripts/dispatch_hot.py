#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dispatch_hot.py —— 用 ECS crontab 主动触发 hot 热榜抓取（服务端定时跑）

为什么需要它
------------
hot 仓库的 `.github/workflows/update.yml` 里声明了

    cron: '5,35 * * * *'      # 每 30 分钟

但 GitHub Actions 对**低活跃仓库**（长期只有 bot 提交）的 schedule 触发会严重
降级。2026-10-13 实测运行间隔：

    10-11 22:24 / 10-12 01:42 / 10-12 09:03 / 10-12 18:57 / 10-13 01:15 (UTC)
    → 间隔 3.3~9.9 小时，平均约 7 小时，仅为理论频率的 ~7%

后果：hot.xhja.cn 长期展示数小时前的旧热点。取证当天站点数据 6.8 小时未更新，
且与微博实时热搜前 20 条的**重合度为 0/20**。

本脚本改由 ECS crontab 每 30 分钟调一次 GitHub 的 workflow_dispatch API，
**主动**唤醒同一条 workflow，完全绕开 schedule 节流。

    update.yml 里的 schedule 保留作为兜底（万一本机或网络故障）。

安全
----
* PAT 放在同目录 config.json（600 权限），绝不写进脚本本体。
* 本脚本只调 workflow_dispatch、只读 run 状态，不碰仓库任何内容。
* 不做任何破坏性操作，失败只写日志。

用法
----
  python3 dispatch_hot.py            # 触发并打印结果
  python3 dispatch_hot.py --quiet    # 精简输出（cron 用）
  python3 dispatch_hot.py --check    # 只看最近一次 run 状态，不触发
  python3 dispatch_hot.py --force    # 即使上一次仍在跑也强制触发

退出码：0 成功（或按设计跳过）；1 失败。
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, 'config.json')

DEFAULTS = {
    'repo': 'xhjxhjcn/hot',
    'workflow': 'update.yml',
    'ref': 'main',
    'api': 'https://api.github.com',
    'timeout': 30,
}

# 上一次 run 处于这些状态时，本轮跳过，避免把 Actions 额度烧在排队上。
BUSY_STATES = ('in_progress', 'queued', 'waiting', 'requested', 'pending')


def log(msg):
    print(time.strftime('[%Y-%m-%d %H:%M:%S] ') + str(msg), flush=True)


def load_config():
    cfg = dict(DEFAULTS)
    if not os.path.exists(CONFIG_PATH):
        raise SystemExit('缺少配置文件：%s' % CONFIG_PATH)
    with open(CONFIG_PATH, encoding='utf-8') as f:
        cfg.update(json.load(f))
    if not cfg.get('token'):
        raise SystemExit('config.json 缺少 token 字段')
    return cfg


def _req(cfg, url, method='GET', payload=None):
    """返回 (http_code, body_text)。网络异常时 code=0。"""
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            'Authorization': 'token ' + cfg['token'],
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'xhj-hot-dispatch',
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg['timeout']) as resp:
            return resp.status, resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        return 0, '%s: %s' % (type(e).__name__, e)


def latest_run(cfg):
    """返回 (info_dict_or_None, http_code, err_text)。"""
    url = '%s/repos/%s/actions/workflows/%s/runs?per_page=1' % (
        cfg['api'], cfg['repo'], cfg['workflow'])
    code, body = _req(cfg, url)
    if code != 200:
        return None, code, body
    runs = (json.loads(body) or {}).get('workflow_runs') or []
    if not runs:
        return None, code, ''
    r = runs[0]
    return {
        'number': r.get('run_number'),
        'status': r.get('status'),
        'conclusion': r.get('conclusion'),
        'created_at': r.get('created_at'),
        'event': r.get('event'),
    }, code, ''


def dispatch(cfg):
    url = '%s/repos/%s/actions/workflows/%s/dispatches' % (
        cfg['api'], cfg['repo'], cfg['workflow'])
    return _req(cfg, url, method='POST', payload={'ref': cfg['ref']})


def main():
    ap = argparse.ArgumentParser(description='主动触发 hot 热榜抓取 workflow')
    ap.add_argument('--quiet', action='store_true', help='精简输出（cron 用）')
    ap.add_argument('--check', action='store_true', help='只查看最近一次 run 状态')
    ap.add_argument('--force', action='store_true', help='上一次仍在跑也强制触发')
    args = ap.parse_args()

    cfg = load_config()

    info, code, err = latest_run(cfg)
    if code == 0:
        log('ERR 无法读取 run 状态：%s' % err[:160])
        return 1
    if code != 200:
        log('ERR 读取 run 状态失败 HTTP %d：%s' % (code, err[:160]))
        return 1

    if info:
        desc = '#%s %s/%s (%s)' % (info['number'], info['status'],
                                   info['conclusion'], info['event'])
    else:
        desc = '(暂无运行记录)'

    if args.check:
        log('最近一次 run：%s' % desc)
        return 0

    if info and info['status'] in BUSY_STATES and not args.force:
        log('SKIP 上一次 run %s 仍在 %s，本轮跳过' % (
            '#' + str(info['number']), info['status']))
        return 0

    code, body = dispatch(cfg)
    if code == 204:
        log('OK 已触发 %s@%s 的 %s（上一次 run %s）' % (
            cfg['repo'], cfg['ref'], cfg['workflow'], desc))
        return 0

    # 常见错误：401 token 失效 / 403 无 workflow 权限 / 404 仓库或 workflow 路径不对
    log('ERR 触发失败 HTTP %d：%s' % (code, body.strip()[:240]))
    return 1


if __name__ == '__main__':
    sys.exit(main())
