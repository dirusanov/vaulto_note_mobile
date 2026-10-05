#!/usr/bin/env python3
"""Build a screenshot tour with ImageMagick + FFmpeg; no fake UI or live-demo claim."""
from pathlib import Path
import html
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/media'
RAW = ROOT / 'store/google-play/_src/raw/en'
FONT = os.environ.get('README_MEDIA_FONT') or next((str(p) for p in [
    Path('/System/Library/Fonts/Supplemental/Arial.ttf'),
    Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
] if p.exists()), None)
STEPS = [
    ('01_record.png', 'Capture a thought.', ['Record an idea while it is fresh.', 'Keep voice and text together.'], 'VOICE NOTES'),
    ('02_offline.png', 'Make it local.', ['Download speech and AI models once.', 'Then process notes on your phone.'], 'OFFLINE AFTER DOWNLOAD'),
    ('04_tasks.png', 'Find your next step.', ['Extract tasks and dates from a note.', 'Set a reminder with a tap.'], 'TASKS & REMINDERS'),
    ('03_ask.png', 'Ask your notes.', ['Find answers in what you saved.', 'Follow the cited source notes.'], 'RECALL & ANSWERS'),
]

def run(args):
    subprocess.run([str(arg) for arg in args], check=True, stdout=subprocess.DEVNULL)

def text(x, y, size, content, color='#d5e1f2', weight='400'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{html.escape(content)}</text>'

def slide(index, step, work):
    filename, heading, lines, eyebrow = step
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">',
             '<rect width="960" height="600" fill="#0c1527"/>',
             '<rect x="600" y="15" width="265" height="570" rx="30" fill="#060b14"/>',
             '<g font-family="Arial, Helvetica, sans-serif">',
             text(48, 63, 16, 'VAULTO NOTE', '#9dbbe7', '700'),
             text(48, 168, 12, eyebrow, '#8bcaff', '700'),
             text(46, 225, 37, heading, '#f4f8ff', '700')]
    for n, line in enumerate(lines):
        parts.append(text(48, 276 + n * 31, 18, line))
    parts.extend([text(48, 404, 15, f'{index + 1:02} / 04', '#9dbbe7', '700'),
                  text(48, 512, 13, 'Real Android screens · release 1.0.87', '#9babbe'),
                  text(48, 539, 13, 'Animated screenshot tour · not a live recording', '#9babbe')])
    for n in range(4):
        color = '#71b8ff' if n == index else '#2c3f5b'
        parts.append(f'<rect x="{48 + n * 90}" y="434" width="74" height="4" rx="2" fill="{color}"/>')
    parts.append('</g></svg>')
    svg = work / f'slide-{index}.svg'
    bg = work / f'background-{index}.png'
    phone = work / f'phone-{index}.png'
    target = work / f'slide-{index}.png'
    svg.write_text('\n'.join(parts))
    run(['magick', '-font', FONT, svg, '-depth', '8', bg])
    run(['magick', RAW / filename, '-resize', '245x544!', phone])
    run(['magick', bg, phone, '-geometry', '+610+28', '-composite', '-depth', '8', target])
    return target

def main():
    for dependency in ('magick', 'ffmpeg'):
        if not shutil.which(dependency):
            raise SystemExit(f'{dependency} is required')
    if not FONT:
        raise SystemExit('Set README_MEDIA_FONT to a readable TrueType font file')
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='vaulto-readme-') as directory:
        work = Path(directory)
        slides = [slide(index, step, work) for index, step in enumerate(STEPS)]
        run(['magick', '-font', FONT, OUT / 'header.svg', '-depth', '8', OUT / 'header.png'])
        run(['magick', OUT / 'header.png', '-background', '#111f36', '-gravity', 'center', '-extent', '1200x630', OUT / 'social-preview.png'])
        run(['magick', *slides, '+append', '-resize', '1920x300!', '-depth', '8', OUT / 'tour-storyboard.png'])
        arguments = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
        for image in slides:
            arguments += ['-loop', '1', '-framerate', '12', '-t', '5', '-i', image]
        filters = []
        for n in range(4):
            filters.append(f'[{n}:v]format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v{n}]')
        filters += [
            '[v0][v1]xfade=transition=fade:duration=0.35:offset=4.65[a]',
            '[a][v2]xfade=transition=fade:duration=0.35:offset=9.30[b]',
            '[b][v3]xfade=transition=fade:duration=0.35:offset=13.95[out]',
        ]
        video = OUT / 'app-tour.mp4'
        run(arguments + ['-filter_complex', ';'.join(filters), '-map', '[out]', '-an', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video])
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
             '-filter_complex', 'fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
             '-loop', '0', OUT / 'app-tour.gif'])
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '6', '-i', video, '-frames:v', '1', '-update', '1', OUT / 'tour-preview.png'])
    for name in ('header.png', 'social-preview.png', 'app-tour.gif', 'app-tour.mp4', 'tour-storyboard.png'):
        path = OUT / name
        print(f'{name}: {path.stat().st_size:,} bytes')

if __name__ == '__main__':
    main()
