"""Render acceptance PDFs and full-height PNG contact sheets; no authoring."""
import json
import re
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from pypdf import PdfReader
import pdfplumber

source, output, poppler = map(Path, sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)
results = []
for file in sorted(source.glob("*.pdf")):
    reader = PdfReader(file)
    texts = [p.extract_text() for p in reader.pages]
    compact = re.sub(r"\s+", "", "\n".join(texts))
    for required in ["完整旅行手册", "旅行总览", "关键时间红线", "全程预算", "出发前清单", "资料来源", "OpenStreetMap"]:
        assert required in compact, (file.name, required)
    assert "\ufffd" not in compact
    with pdfplumber.open(file) as pdf:
        for i, page in enumerate(pdf.pages):
            chars = [c for c in page.chars if c['text'].strip()]
            assert chars and not [c for c in chars if c['x0'] < 32 or c['x1'] > page.width - 32 or c['top'] < 28 or c['bottom'] > page.height - 28], (file.name, i)
            assert f"第{i+1}/{len(reader.pages)}页" in re.sub(r"\s+", "", texts[i])
    (output / f"{file.stem}.txt").write_text("\n\f\n".join(texts), encoding="utf-8")
    subprocess.run([str(poppler / 'pdftoppm.exe'), '-r', '85', '-png', str(file), str(output / 'live-page')], check=True)
    images = sorted(output.glob('live-page-*.png'))
    assert len(images) == len(reader.pages)
    for start in range(0, len(images), 4):
        canvas = Image.new('RGB', (1440, 2090), '#ccd2cd')
        for n, name in enumerate(images[start:start+4]):
            im = Image.open(name).convert('RGB'); im.thumbnail((700, 990))
            x, y = (n % 2)*720+10, (n//2)*1045+35
            canvas.paste(im, (x, y)); ImageDraw.Draw(canvas).text((x, y-22), f'page {start+n+1}/{len(images)}', fill='black')
        canvas.save(output / f'live-contact-{start//4+1:02d}.jpg', quality=92)
    results.append({'file': file.name, 'pages': len(reader.pages), 'textAndBoundsPassed': True})

tiles = []
for file in sorted(source.glob('*.png')):
    if not (file.name.startswith('Serendipity-') or re.match(r'[24]days-\d+\.png$', file.name)):
        continue
    im = Image.open(file).convert('RGB')
    for y in range(0, im.height, 2600):
        part = im.crop((0, max(0, y-50), im.width, min(im.height, y+2600)))
        part.thumbnail((700, 1850))
        tiles.append((file.name, y, part))
    results.append({'file': file.name, 'width': im.width, 'height': im.height, 'fullHeightTiled': True})
for start in range(0, len(tiles), 2):
    canvas = Image.new('RGB', (1440, 1920), '#ccd2cd')
    for n, (name, y, im) in enumerate(tiles[start:start+2]):
        canvas.paste(im, (n*720+10, 40)); ImageDraw.Draw(canvas).text((n*720+10, 10), f'{name} y={y}', fill='black')
    canvas.save(output / f'png-contact-{start//2+1:02d}.jpg', quality=92)
(output / 'verification.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(results, ensure_ascii=False))
