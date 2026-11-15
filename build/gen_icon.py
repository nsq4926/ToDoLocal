"""生成应用图标 build/icon.ico（纯标准库，256x256 PNG-in-ICO）。"""
import math
import os
import struct
import zlib

W = H = 256


def clamp(v):
    return max(0.0, min(1.0, v))


def round_rect(px, py):
    qx = abs(px - 128) - (112 - 46)
    qy = abs(py - 128) - (112 - 46)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - 46


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


rows = []
for y in range(H):
    row = []
    for x in range(W):
        px, py = x + 0.5, y + 0.5
        a_bg = clamp(0.5 - round_rect(px, py))
        if a_bg <= 0:
            row.append((0, 0, 0, 0))
            continue
        k = (py - 16) / 224.0
        base = (int(58 - 14 * k), int(126 - 26 * k), int(223 - 28 * k))
        d = min(seg_dist(px, py, 72, 132, 108, 168), seg_dist(px, py, 108, 168, 186, 88)) - 9
        a_w = clamp(0.5 - d)
        row.append((
            int(base[0] * (1 - a_w) + 255 * a_w),
            int(base[1] * (1 - a_w) + 255 * a_w),
            int(base[2] * (1 - a_w) + 255 * a_w),
            int(255 * a_bg),
        ))
    rows.append(row)

raw = b''.join(b'\x00' + bytes(c for px in row for c in px) for row in rows)


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9))
       + chunk(b'IEND', b''))
ico = struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22) + png

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icon.ico')
with open(out, 'wb') as f:
    f.write(ico)
print('icon written:', out, len(ico), 'bytes')
