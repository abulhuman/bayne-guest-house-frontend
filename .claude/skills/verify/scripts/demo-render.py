#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import textwrap
import time

parser = argparse.ArgumentParser(description='Render whole-dialog framing and captions from a demo capture.')
parser.add_argument('source', type=Path)
parser.add_argument('events', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--width', type=int, default=1920)
parser.add_argument('--no-zoom', action='store_true')
args = parser.parse_args()
if args.width < 320 or args.width % 2:
    parser.error('--width must be an even integer of at least 320')
log = json.loads(args.events.read_text())
fps = log['fps']
dsf = log.get('dsf', 2)
vw, vh = log['viewport']['width'], log['viewport']['height']
height = round(args.width * vh / vw / 2) * 2
band = round(args.width / vw * 64 / 2) * 2
frames = [(0, vw / 2, vh / 2, 1)]
for event in log['events']:
    if event['type'] != 'dialog':
        continue
    box = event['box']
    t = event['t'] / 1000
    if box:
        zoom = max(1, min(1.6, vw / (box['width'] + 80), vh / (box['height'] + 80)))
        halfw, halfh = vw / zoom / 2, vh / zoom / 2
        x = min(max(box['x'] + box['width'] / 2, halfw), vw - halfw)
        y = min(max(box['y'] + box['height'] / 2, halfh), vh - halfh)
    else:
        x, y, zoom = vw / 2, vh / 2, 1
    if (x, y, zoom) != frames[-1][1:]:
        frames.append((t, x, y, zoom))


def camera(t):
    x, y, zoom = frames[0][1:]
    for i, (start, *target) in enumerate(frames[1:], 1):
        duration = 0.28 if target[2] == 1 else 0.55
        if i + 1 < len(frames):
            duration = min(duration, max(0.001, frames[i + 1][0] - start))
        u = min(max((t - start) / duration, 0), 1)
        eased = u * u * (3 - 2 * u)
        x, y, zoom = (value + (to - origin) * eased for value, origin, to in zip((x, y, zoom), frames[i - 1][1:], target))
    sw, sh = round(vw * dsf / zoom), round(vh * dsf / zoom)
    sx = min(max(round(x * dsf - sw / 2), 0), vw * dsf - sw)
    sy = min(max(round(y * dsf - sh / 2), 0), vh * dsf - sh)
    return sw, sh, sx, sy


captions = []
for i, event in enumerate(log['events']):
    if event['type'] == 'caption':
        end = next((e['t'] for e in log['events'][i + 1:] if e['type'] in ('captionClear', 'caption', 'end')), log['end'])
        captions.append((event['t'] / 1000, end / 1000, event['text']))
started = time.monotonic()
with tempfile.TemporaryDirectory(prefix='demo-render-') as tmp:
    filters = [f'fps={fps}']
    if not args.no_zoom and len(frames) > 1:
        commands, last = [], None
        for n in range(int(log['end'] / 1000 * fps) + 2):
            crop = camera(n / fps)
            if crop != last:
                commands.append(f'{n / fps:.4f} ' + ', '.join(f'crop {k} {v}' for k, v in zip('whxy', crop)) + ';')
                last = crop
        path = Path(tmp) / 'camera.txt'
        path.write_text('\n'.join(commands))
        filters += [f"sendcmd=f='{path}'", 'crop=w=iw:h=ih:x=0:y=0:exact=1']
    filters.append(f'scale={args.width}:{height}:flags=lanczos')
    filters.append(f'pad={args.width}:{height + band}:0:0:color=0x0f172a')
    if captions:
        font = subprocess.check_output(['fc-match', '-f', '%{file}', 'sans:semibold'], text=True)
        for i, (start, end, caption) in enumerate(captions):
            path = Path(tmp) / f'caption-{i}.txt'
            path.write_text(textwrap.fill(caption, width=100))
            filters.append(f"drawtext=fontfile='{font}':textfile='{path}':expansion=none:fontsize={round(18 * args.width / vw)}:fontcolor=white:line_spacing=6:x=(w-text_w)/2:y={height}+(h-{height}-text_h)/2:enable='gte(t,{start:.4f})*lt(t,{end:.4f})'")
    filters += ['mpdecimate=hi=0:lo=0:frac=0:max=30', 'format=yuv420p']
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(args.source), '-vf', ','.join(filters), '-fps_mode', 'vfr', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', str(args.output)], check=True)
print(f'RENDER {args.output} zoom={int(not args.no_zoom)} cameras={len(frames)} captions={len(captions)} wall={time.monotonic() - started:.2f}s bytes={args.output.stat().st_size}')
