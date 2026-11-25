"""生成应用图标 build/icon.ico（纯标准库，多尺寸 PNG-in-ICO）。

图标同时写入 build/icon.ico（打包用）与 src/icon.ico（开发态窗口 / 托盘用），
保证窗口图标、任务栏图标与托盘图标来自同一份资源，不会出现不一致。

用法：python build/gen_icon.py
"""
import math
import os
import shutil
import struct
import zlib

# 单帧 256 图标在任务栏 16/24px 场景下会被 Windows 回退到 exe 自带图标，
# 因此这里按 Windows 常用尺寸逐级生成，任务栏与托盘都能取到原生尺寸。
SIZES = [16, 24, 32, 48, 64, 128, 256]

# 圆角矩形：半边长 112/256，圆角半径 46/256
HALF = 112.0 / 256.0
RADIUS = 46.0 / 256.0
# 对勾折线：(72,132) → (108,168) → (186,88)，线宽 9/256
CHECK = [(72.0 / 256, 132.0 / 256), (108.0 / 256, 168.0 / 256), (186.0 / 256, 88.0 / 256)]
STROKE = 9.0 / 256.0


def clamp(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def round_rect(px, py):
    qx = abs(px - 0.5) - (HALF - RADIUS)
    qy = abs(py - 0.5) - (HALF - RADIUS)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - RADIUS


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def sample(px, py, size):
    """归一化坐标 → (r, g, b, a)，a 为 0..1 覆盖率。"""
    a_bg = clamp(0.5 - round_rect(px, py) * size)
    if a_bg <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)

    k = clamp((py - 16.0 / 256.0) / (224.0 / 256.0))
    base = (58.0 - 14.0 * k, 126.0 - 26.0 * k, 223.0 - 28.0 * k)

    d = min(seg_dist(px, py, *CHECK[0], *CHECK[1]), seg_dist(px, py, *CHECK[1], *CHECK[2])) - STROKE / 2.0
    a_w = clamp(0.5 - d * size)
    return (
        base[0] * (1.0 - a_w) + 255.0 * a_w,
        base[1] * (1.0 - a_w) + 255.0 * a_w,
        base[2] * (1.0 - a_w) + 255.0 * a_w,
        a_bg,
    )


def render(size):
    """超采样渲染 RGBA 像素，返回 bytes（每行 1 字节 filter + RGBA）。"""
    ss = 4 if size <= 64 else 2
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc_a = 0.0
            acc_r = acc_g = acc_b = 0.0
            for sy in range(ss):
                py = (y + (sy + 0.5) / ss) / size
                for sx in range(ss):
                    px = (x + (sx + 0.5) / ss) / size
                    r, g, b, a = sample(px, py, size)
                    if a <= 0.0:
                        continue
                    acc_a += a
                    acc_r += r * a
                    acc_g += g * a
                    acc_b += b * a
            if acc_a <= 0.0:
                row += b'\x00\x00\x00\x00'
                continue
            row += bytes((
                int(round(clamp(acc_r / acc_a / 255.0) * 255.0)),
                int(round(clamp(acc_g / acc_a / 255.0) * 255.0)),
                int(round(clamp(acc_b / acc_a / 255.0) * 255.0)),
                int(round(clamp(acc_a / (ss * ss)) * 255.0)),
            ))
        rows.append(b'\x00' + bytes(row))
    return b''.join(rows)


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(size, raw):
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def build_ico():
    frames = [(size, png(size, render(size))) for size in SIZES]
    header = struct.pack('<HHH', 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries = b''
    body = b''
    for size, data in frames:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        body += data
        offset += len(data)
    return header + entries + body


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ico = build_ico()
    targets = [os.path.join(here, 'icon.ico'), os.path.join(here, '..', 'src', 'icon.ico')]
    for target in targets:
        target = os.path.normpath(target)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(ico)
        print('icon written:', target, len(ico), 'bytes', 'sizes=' + ','.join(str(s) for s in SIZES))


if __name__ == '__main__':
    main()
