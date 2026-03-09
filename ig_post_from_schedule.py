#!/usr/bin/env python3
"""ig_schedulerのschedule.jsonの先頭1件を投稿してpostedに移動する"""
import json, sys, subprocess, requests, datetime
from pathlib import Path

SCHEDULE = Path('/home/ec2-user/projects/ig_scheduler/data/schedule.json')
IG_POST  = Path('/home/ec2-user/workspace/scripts/instagram/ig_post.py')
API_BASE = 'http://localhost:8801'
LOG      = Path.home() / 'logs/ig_scheduler_cron.log'

def log(msg):
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    line = f"{ts} ig_scheduler: {msg}"
    print(line)
    with open(LOG, 'a') as f: f.write(line + '\n')

def tg_send(token, chat_id, text):
    try:
        requests.post(f'https://api.telegram.org/bot{token}/sendMessage',
                      data={'chat_id': chat_id, 'text': text}, timeout=10)
    except: pass

def main():
    # Telegram token取得
    tg_token = json.load(open('/home/ec2-user/.openclaw/openclaw.json'))['channels']['telegram']['botToken']
    MASTER = '8579868590'
    HINO   = '7107850192'

    data = json.load(open(SCHEDULE))
    if not data['posts']:
        log('empty, skipping.')
        tg_send(tg_token, MASTER, '📭 投稿予定がありませんでした。')
        return

    post = data['posts'][0]
    post_id = post['id']
    images  = post['images']
    caption = post['caption']
    log(f'posting id={post_id} ({len(images)}枚)')

    # 投稿
    # 画像をタイムスタンプ付きファイル名でig_hostingにコピー（URLキャッシュ回避）
    import shutil, time
    ig_hosting = Path('/home/ec2-user/projects/bizeny/images/ig_hosting')
    ig_hosting.mkdir(exist_ok=True)
    ts = int(time.time())
    new_images = []
    for i, img_path in enumerate(images):
        ext = Path(img_path).suffix
        new_name = f'ig_{ts}_{i}{ext}'
        dst = ig_hosting / new_name
        shutil.copy2(img_path, dst)
        new_images.append(str(dst))

    if len(new_images) == 1:
        cmd = [sys.executable, str(IG_POST), '-a', 'bizenyakiko', 'post', new_images[0], caption]
    else:
        cmd = [sys.executable, str(IG_POST), '-a', 'bizenyakiko', 'carousel'] + new_images + ['--caption', caption]

    result = subprocess.run(cmd, capture_output=True, text=True)
    output = result.stdout + result.stderr
    log(f'exit={result.returncode} output={output[:200]}')

    if result.returncode != 0:
        log('投稿失敗！中断します。')
        # コピーした一時ファイルをクリーンアップ
        for p in new_images:
            try: Path(p).unlink()
            except: pass
        tg_send(tg_token, MASTER, f'❌ 投稿失敗！\nID: {post_id}\n{output[:200]}')
        sys.exit(1)

    # schedule → posted に直接移動
    jst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    post['posted_at'] = jst.strftime('%Y-%m-%d %H:%M JST')
    data['posts'].pop(0)
    json.dump(data, open(str(SCHEDULE),'w'), ensure_ascii=False, indent=2)
    posted_file = SCHEDULE.parent / 'posted.json'
    posted = json.load(open(posted_file))
    posted['posts'].append(post)
    json.dump(posted, open(str(posted_file),'w'), ensure_ascii=False, indent=2)
    log(f'posted.jsonに移動完了: {post_id}')

    msg = f'✅ Instagram投稿しました！\nID: {post_id}\n投稿日時: {jst.strftime("%Y-%m-%d %H:%M JST")}\n画像: {len(images)}枚'
    tg_send(tg_token, MASTER, msg)
    tg_send(tg_token, HINO,   msg)
    log('done.')

if __name__ == '__main__':
    main()
