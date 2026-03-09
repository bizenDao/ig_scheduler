#!/usr/bin/env python3
"""ig_scheduler 在庫レポート — 毎朝JST 10:00にひのちゃん＆マスターへ送信"""
import json, datetime, requests
from pathlib import Path

DATA_DIR = Path('/home/ec2-user/projects/ig_scheduler/data')
LOG = Path.home() / 'logs/ig_scheduler_cron.log'

# タイプ定義（IDプレフィックス → 表示名）
TYPES = {
    '4koma':     '4コマ漫画',
    'bizenlife': '備前焼のある食卓',
    'friends':   '友人エピソード',
}
WARN_THRESHOLD = 3  # 予定がこの件数以下で警告

def log(msg):
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    line = f"{ts} daily_report: {msg}"
    print(line)
    with open(LOG, 'a') as f: f.write(line + '\n')

def tg_send(token, chat_id, text):
    try:
        requests.post(f'https://api.telegram.org/bot{token}/sendMessage',
                      data={'chat_id': chat_id, 'text': text}, timeout=10)
    except Exception as e:
        log(f'Telegram送信エラー: {e}')

def count_by_type(stage):
    """指定ステージのJSONをtypeごとに集計"""
    try:
        posts = json.load(open(DATA_DIR / f'{stage}.json'))['posts']
    except:
        return {}
    counts = {t: 0 for t in TYPES}
    counts['other'] = 0
    for p in posts:
        pid = p.get('id', '')
        matched = False
        for prefix in TYPES:
            if pid.startswith(prefix):
                counts[prefix] += 1
                matched = True
                break
        if not matched:
            counts['other'] += 1
    return counts

def main():
    tg_token = json.load(open('/home/ec2-user/.openclaw/openclaw.json'))['channels']['telegram']['botToken']
    MASTER = '8579868590'
    HINO   = '7107850192'

    schedule = count_by_type('schedule')
    draft    = count_by_type('draft')

    jst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    lines = [f'📊 ig_scheduler 在庫レポート（{jst.strftime("%m/%d %H:%M")} JST）\n']

    warnings = []
    for prefix, label in TYPES.items():
        s = schedule.get(prefix, 0)
        d = draft.get(prefix, 0)
        lines.append(f'{label}　予定 {s}件 / 下書き {d}件')
        if s <= WARN_THRESHOLD:
            warnings.append(f'⚠️ {label}の在庫が残り{s}件です。')

    if schedule.get('other', 0) or draft.get('other', 0):
        lines.append(f'その他　予定 {schedule.get("other",0)}件 / 下書き {draft.get("other",0)}件')

    if warnings:
        lines.append('')
        lines.extend(warnings)
        lines.append('原稿の支給をお願いします🙏')

    msg = '\n'.join(lines)
    log(f'レポート送信: {msg[:80]}...')
    tg_send(tg_token, MASTER, msg)
    tg_send(tg_token, HINO, msg)
    log('done.')

if __name__ == '__main__':
    main()
