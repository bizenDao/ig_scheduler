# ig_scheduler

Instagram投稿スケジューラー for @bizenyakiko

## フロー

```
draft → proposal → schedule → posted
```

| ファイル | 説明 |
|---|---|
| `data/draft.json` | 彰子が作った案（ひのちゃん未確認） |
| `data/proposal.json` | ひのちゃん確認中 |
| `data/schedule.json` | 承認済みキュー（cronが読む） |
| `data/posted.json` | 投稿済みログ |

## JSONフォーマット

```json
{
  "posts": [
    {
      "id": "vol7_shokutaku",
      "images": ["/path/to/image1.jpg", "/path/to/image2.jpg"],
      "caption": "キャプション"
    }
  ]
}
```

## 運用ルール

- `schedule.json` に入っている = ひのちゃん承認済み
- cronが1日3回 FIFO で `schedule.json[0]` を投稿
- Keep Simple — 余計な操作を入れない
