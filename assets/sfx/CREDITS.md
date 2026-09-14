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

---

## 脚步采样（CC0 1.0 公有领域）

| 文件 | 原始素材 | 来源 | 许可 |
|---|---|---|---|
| `footsteps/footstep-01~06.wav` | Fantozzi's Footsteps (Grass/Sand & Stone) → StoneL1-3 / StoneR1-3 | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | **CC0 1.0** |
| `footsteps/footstep-07~12.wav` | Footsteps（地铁站硬地）→ 01~06 | https://opengameart.org/content/footsteps-0 | **CC0 1.0** |

处理方式：原文件为 44.1/48kHz 立体声（FLAC / OGG），本项目统一转为
**单声道 / 22.05kHz / 16bit WAV**（与既有换弹音效同规格），并做
`loudnorm I=-20 LUFS` 响度归一 + 3ms 首淡入 / 20ms 尾淡出（防爆音）。
转码后峰值电平 -2.0 ~ -3.7 dB，无削波。

### 许可核实说明（重要，请勿简化）

- 两个包的 OGA 页面 `License(s):` 字段均为 **CC0**。
- **Fantozzi 包的上游已独立核实**：OGA 正文注明素材取自
  `freesound.org/people/Fantozzi/packs/10338/`，该 pack 内音效详情页的许可链接指向
  `creativecommons.org/publicdomain/zero/1.0/` —— provenance 链闭合，CC0 再发布声明成立。
- `footsteps-0` 包页面另有 `Copyright/Attribution Notice: None at all, use freely :)`。
- ⚠️ **两个包内均无许可文件**（无 readme / LICENSE / creativecommons.txt），属**页面级声明**。
  这与本项目已有的 OGA 换弹音效（同样以页面 License 字段确认 CC0）标准一致。
  由于包内不存在许可文件，也**不可能出现**历史记录里那种「页面标 CC0、包内实为 CC-BY 3.0」的自相矛盾。
- **已排除的候选**（记录备查）：
  - `Different Steps on Wood, Stone, Leaves...` —— 上游 pdsounds.org 已变为停放域名，
    公有领域声明无法独立验证，权利链不可考。
  - `Footsteps Leather, Cloth, Armor` —— OGA-BY 3.0 与 CC0 **双许可**。双许可本身不违规
    （OGA FAQ 裁定「只需遵守其中之一」），但需在 NOTICE 额外声明未采用 OGA-BY，故未采用。
  - `Metal footsteps on concrete` —— 25 个变体但时长仅 0.08~0.23s，偏「咔」声而非脚步声，未采用。
- **Freesound.org 实测不可用**：原始文件下载 302 跳转登录页，API 无 token 返回 401。
  （其 CDN 预览文件可免认证拉到，但绕过官方下载接口属灰区，未采用。）

**注意：素材内容与文件名的对应关系未经试听验证** —— 上述"石质/地铁硬地"的判断来自
页面描述与文件名（Fantozzi 页面有上传者明文 *"'Stone' could be most hard surfaces"*）。
如需确认音色是否合适，请实际试听。

若日后替换这些采样，**保持文件名不变**即可，代码无需改动（`FOOTSTEP_FILES` 路径不变）。
