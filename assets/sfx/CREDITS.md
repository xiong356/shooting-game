# 音效素材来源与许可

本目录下的音频文件来源与授权如下。**修改前请先确认许可条款。**

---

## 真实采样（CC0 1.0 公有领域）

| 文件 | 原始素材 | 来源 | 许可 |
|---|---|---|---|
| `mag-out.wav` | Gun reload sounds → `gunreload1.wav` | https://opengameart.org/content/gun-reload-sounds | **CC0 1.0** |
| `mag-in.wav` | Gun reload sounds → `assaultriflereload1_0.wav` | https://opengameart.org/content/gun-reload-sounds | **CC0 1.0** |
| `bolt-click.mp3` | Gun reload, lock or click sound | https://opengameart.org/content/gun-reload-lock-or-click-sound | **CC0 1.0** |

处理方式：原文件为 44.1kHz 双声道 WAV，本项目处理为 **单声道 / 22.05kHz / 16bit**，
并做了静音裁剪、归一化与 15ms 尾部淡出，以控制体积。`bolt-click.mp3` 原样保留（未做解码处理）。

CC0 1.0 全文：https://creativecommons.org/publicdomain/zero/1.0/
无需署名，此处仍保留来源记录以便追溯。

---

## 程序化合成（本项目自有，无第三方权利）

| 文件 | 说明 |
|---|---|
| `ak47-shot.wav` | AK-47（7.62×39）单发报告声，7 层物理模型合成 |

合成分层：冲击前沿（全频 1.6ms）→ 超音速锐响（高通 4ms）→ 爆鸣（带通 2~8kHz）
→ 膛音（带通 1.1kHz）→ 低频轰（180→55Hz 扫频）→ 户外反射尾 → 机械闭锁/抽壳。
高频增益经自动调参，使起音窗（0~8ms）高频/低频 = -12dB。

生成脚本：`<临时目录>/sfx-synth2.js`（纯 Node，零依赖，含确定性 PRNG）。

---

## ⚠️ 已排除的素材（记录备查）

| 素材 | 排除原因 |
|---|---|
| OGA "Gunshot Sounds" → `sounds.zip`（含 SKS 步枪真实录音） | ① 页面元数据标 CC0，但包内 `creativecommons.txt` 写明 **CC-BY 3.0**，许可自相矛盾；② 实测波形不合格（起音在 20ms 内缓慢爬升，无枪声应有的 1~2ms 尖锐前沿，噪声底极高） |
| happysoulmusic.com "Retro Game Weapons Sound Effects" | 声称 CC0，但页面无任何可直链下载的音频（JS 动态渲染），无法核实具体文件 |
| Wikimedia Commons 枪声音频 | API 请求持续超时，本站网络不可达 |
| Pixabay CDN | 直连返回 403 |
| OGA 全站扫描（109 个内容页，10 组关键词） | 无任何"许可字段为 CC0 且可直链下载"的步枪/机枪枪声 |

**若后续取得许可干净的真实 AK-47 录音**，只需覆盖 `ak47-shot.wav` 同名文件即可，
代码无需改动（`WEAPON_SFX` 注册表中的路径不变）。
