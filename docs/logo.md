# Frogie 视觉标识

2026 年 9 月确认的标识保留了坐姿歌唱的青蛙、黄绿色切面和彩虹音符。展示图标采用较深的鼠尾草绿背景，搭配浅淡曲线和轻微阴影。

| 文件 | 用途 |
| --- | --- |
| `logo.png` | 原生 2048 × 2048 透明前景，作为标准原图 |
| `assets/brand/icon.png` | 已确认的方形图标，包含背景和阴影 |
| `assets/brand/icon-rounded.png` | 四角透明的圆角展示图，用于 README 和社交图片 |
| `assets/brand/provenance.json` | 确认记录、源文件归档和原图校验值 |

hexly.ai 仓库的 `artwork/logo-family/frogie/2026-09-06-01/` 保存了旧 logo、提示词、未经修改的 Azure gpt-image-2 生成图、蒙版、图层，以及每一轮精修结果。本仓库采用精修版 `03`，即用户选择的深色背景版本。其透明前景与此前采用的精修版 `02` 逐字节相同。[本地 logo 图库](https://index.dev.hexly.ai/logos/frogie) 展示了最终标识和历史版本。按原采纳记录，这次后续调整的发布仍处于暂停状态。

使用 Python 和 Pillow 重新生成所有已提交的应用衍生图片：

```bash
uv run --with pillow --no-project scripts/resize-logos.py
```

保留的侧栏和登录页图片分别使用 24 px 和 80 px 的透明前景。PNG favicon 和已经校验的 16/32 px ICO 图层同样保持透明，不添加底板、背景纹样或额外裁剪。README 使用 128 px 圆角展示图。Apple touch 图标使用方形原图，由操作系统处理圆角。Open Graph 图片将圆角图标放在既有深色背景上。应保留已确认的构图，不能用纯色填充重新制作鼠尾草绿背景。

图标背景色是 `#BBCB9E`，从图稿采样的叶绿色是 `#86C32C`。原应用的界面主题令牌采用独立配色，其中主色为 `#21C45D`；这些是历史界面信息，不代表新界面的选型。音符属于吉祥物设计，Frogie 的产品方向仍是 Agent 工作空间。

通用使用和采纳流程见 `hexly.ai/docs/07-logo-usage-sop.md`。原应用的重新生成检查项包括侧栏的两种状态、登录页、README、浏览器元数据和两个完整审阅页面。旧应用已移除，当前只能检查仍然保留的资产与 README；未来重新接入界面时，应补上相应检查。
