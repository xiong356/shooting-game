# -*- coding: utf-8 -*-
"""README 顶部横幅生成器（docs/banner.png）。
深色渐变 + 居中标题 + 底部蓝紫渐变条，风格对齐标准开源仓库 hero banner。
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

W, H = 1280, 400
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"

img = Image.new("RGB", (W, H))
px = img.load()

# ---- 纵向渐变：顶部深海军蓝 -> 底部靛蓝 ----
top = (13, 21, 38)       # #0d1526
bottom = (27, 42, 78)    # #1b2a4a
for y in range(H):
    t = y / (H - 1)
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    for x in range(W):
        px[x, y] = (r, g, b)

draw = ImageDraw.Draw(img, "RGBA")

# ---- 中心淡光晕 ----
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W // 2 - 420, -140, W // 2 + 420, 300], fill=(70, 110, 200, 55))
glow = glow.filter(ImageFilter.GaussianBlur(90))
img.paste(glow, (0, 0), glow)

# ---- 背景细节：稀疏星点 + 淡网格 ----
draw = ImageDraw.Draw(img, "RGBA")
for i in range(46):
    x = (i * 271) % W
    y = (i * 157) % H
    a = 26 + (i * 13) % 40
    draw.ellipse([x, y, x + 2, y + 2], fill=(200, 220, 255, a))
for gx in range(0, W, 80):
    draw.line([(gx, 0), (gx, H)], fill=(255, 255, 255, 7), width=1)
for gy in range(0, H, 80):
    draw.line([(0, gy), (W, gy)], fill=(255, 255, 255, 7), width=1)

# ---- 两侧准星装饰 ----
def crosshair(cx, cy, arm=26, gap=8, color=(120, 160, 230, 90)):
    draw.line([(cx - arm, cy), (cx - gap, cy)], fill=color, width=2)
    draw.line([(cx + gap, cy), (cx + arm, cy)], fill=color, width=2)
    draw.line([(cx, cy - arm), (cx, cy - gap)], fill=color, width=2)
    draw.line([(cx, cy + gap), (cx, cy + arm)], fill=color, width=2)

crosshair(120, 200)
crosshair(W - 120, 200)

# ---- 文字 ----
def center_text(text, font, y, fill, tracking=0):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    x = (W - tw) // 2
    if tracking == 0:
        draw.text((x, y), text, font=font, fill=fill)
    else:
        cx = x
        for ch in text:
            draw.text((cx, y), ch, font=font, fill=fill)
            cb = draw.textbbox((0, 0), ch, font=font)
            cx += (cb[2] - cb[0]) + tracking

f_title = ImageFont.truetype(FONT_BOLD, 84)
f_sub = ImageFont.truetype(FONT_REG, 34)
f_tag = ImageFont.truetype(FONT_REG, 22)

center_text("王者峡谷 PvE", f_title, 108, (245, 248, 255, 255))
center_text("野怪追逐 · 第一人称射击", f_sub, 222, (168, 192, 232, 255), tracking=6)
center_text("7 关线性闯关  ·  三阶段 Boss  ·  Three.js 零构建", f_tag, 288, (122, 146, 189, 255), tracking=2)

# ---- 底部蓝紫渐变条 ----
bar_h = 7
for x in range(W):
    t = x / (W - 1)
    r = int(59 + (139 - 59) * t)     # #3b82f6 -> #8b5cf6
    g = int(130 + (92 - 130) * t)
    b = int(246 + (246 - 246) * t)
    draw.line([(x, H - bar_h), (x, H)], fill=(r, g, b, 255))

img.save("D:/workbuddy/game/shoot/docs/banner.png", optimize=True)
print("saved", img.size)
