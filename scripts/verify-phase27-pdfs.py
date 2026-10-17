"""Read every page, verify embedded fonts/text/bounds, render via Poppler.
Usage: bundled-python scripts/verify-phase27-pdfs.py INPUT_DIR OUTPUT_DIR POPPLER_DIR
Only synthetic PDFs belong in the acceptance directory.
"""
import json
import re
import subprocess
import sys
from pathlib import Path
import pdfplumber
from pypdf import PdfReader
from PIL import Image, ImageDraw

source, output, poppler = map(Path, sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)
results = []
for name in ["2days", "4days", "stress"]:
    file = source / f"{name}.pdf"
    if not file.exists():
        continue
    reader = PdfReader(file)
    text_pages = [p.extract_text() for p in reader.pages]
    compact = re.sub(r"\s+", "", "\n".join(text_pages))
    for required in ["完整旅行手册", "旅行总览", "关键时间红线", "景点推荐", "餐厅推荐", "住宿区域", "全程预算", "出发前清单", "旅行提醒", "资料来源", "22:55", "1500元", "OpenStreetMap"]:
        assert required in compact, (name, required)
    assert "合成隐私街道88号星河小区3栋1201室" not in compact
    assert "08车06A" not in compact
    assert "\ufffd" not in compact
    expected_meta = source / f"{name}.json"
    if expected_meta.exists():
        assert len(reader.pages) == json.loads(expected_meta.read_text())['pages']
    if name == "stress":
        assert "长卡片终点" in compact
        assert "跨城位置总览" in compact and "上海·当地位置详图" in compact
        for i in range(1, 71):
            assert f"压力清单第{i}项" in compact
        for i in range(1, 37):
            assert f"来源终点{i}" in compact
    fonts = set()
    for index, page in enumerate(reader.pages):
        assert abs(float(page.mediabox.width) - 595.28) < 1
        assert abs(float(page.mediabox.height) - 841.89) < 1
        assert f"第{index+1}/{len(reader.pages)}页" in re.sub(r"\s+", "", text_pages[index]), (name, index)
        for ref in page['/Resources']['/Font'].values():
            font = ref.get_object()
            descendants = font.get('/DescendantFonts', [font])
            for desc in descendants:
                obj = desc.get_object()
                descriptor = obj.get('/FontDescriptor')
                assert descriptor is not None, (name, obj)
                descriptor = descriptor.get_object()
                if obj.get('/Subtype') == '/Type3':
                    # Chromium stores synthesized bold glyphs as self-contained
                    # vector CharProcs, with ToUnicode for selectable text.
                    assert obj.get('/CharProcs') and obj.get('/ToUnicode')
                    assert all(ref.get_object().get_data() for ref in obj['/CharProcs'].values())
                else:
                    assert any(key in descriptor for key in ['/FontFile', '/FontFile2', '/FontFile3']), (name, obj.get('/BaseFont'))
                fonts.add(str(obj.get('/BaseFont', descriptor.get('/FontName'))))
    bounds = []
    with pdfplumber.open(file) as pdf:
        for i, page in enumerate(pdf.pages):
            chars = [c for c in page.chars if c['text'].strip()]
            assert chars, (name, i, 'empty page')
            outside = [c for c in chars if c['x0'] < 32 or c['x1'] > page.width - 32 or c['top'] < 28 or c['bottom'] > page.height - 28]
            assert not outside, (name, i, outside[:3])
            bounds.append({'page': i+1, 'characters': len(chars), 'top': min(c['top'] for c in chars), 'bottom': max(c['bottom'] for c in chars)})
    (output / f'{name}.txt').write_text('\n\f\n'.join(text_pages), encoding='utf-8')
    prefix = output / f'{name}-page'
    subprocess.run([str(poppler / 'pdftoppm.exe'), '-r', '85', '-png', str(file), str(prefix)], check=True)
    images = sorted(output.glob(f'{name}-page-*.png'))
    assert len(images) == len(reader.pages)
    # Full-page contact sheets: every page remains available at original size.
    for start in range(0, len(images), 4):
        canvas = Image.new('RGB', (1440, 2090), '#ccd2cd')
        draw = ImageDraw.Draw(canvas)
        for n, image_path in enumerate(images[start:start+4]):
            im = Image.open(image_path).convert('RGB'); im.thumbnail((700, 990))
            x, y = (n % 2)*720+10, (n//2)*1045+35
            canvas.paste(im, (x, y)); draw.text((x, y-22), f'{name}: page {start+n+1}/{len(images)}', fill='black')
        canvas.save(output / f'{name}-contact-{start//4+1:02d}.jpg', quality=92)
    results.append({'name': name, 'pages': len(reader.pages), 'fonts': sorted(fonts), 'textChecks': True, 'pageBounds': bounds})
(output / 'verification.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps([{'name': r['name'], 'pages': r['pages'], 'embeddedFonts': len(r['fonts'])} for r in results]))
