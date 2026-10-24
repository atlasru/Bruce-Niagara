"""Render layout illustrations from the bundled TFT font (requires Pillow)."""
from PIL import Image, ImageDraw
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
source = (ROOT / 'lib/TFT_eSPI/Fonts/glcdfont.c').read_text()
source = re.sub(r'/\*.*?\*/|//[^\n]*', '', source, flags=re.S)
body = re.search(r'font\[\]\s+PROGMEM\s*=\s*\{(.*?)\};', source, re.S).group(1)
FONT = bytes(int(value, 16) for value in re.findall(r'0x([0-9a-fA-F]{2})', body))
assert len(FONT) >= 128 * 5
palette = json.loads((OUT / 'niagara-lime.json').read_text())
background = int(palette['bgColor'], 16)
foreground = int(palette['secColor'], 16)
accent = int(palette['priColor'], 16)
muted = ((((foreground >> 11) * 3 + (background >> 11)) // 4) << 11 |
         (((((foreground >> 5) & 63) * 3 + ((background >> 5) & 63)) // 4) << 5) |
         (((foreground & 31) * 3 + (background & 31)) // 4))

def rgb565(value):
    return ((value >> 11) * 255 // 31, ((value >> 5) & 63) * 255 // 63, (value & 31) * 255 // 31)

def preview(name, title, labels, selected):
    screen = Image.new('RGB', (170, 320), rgb565(background))
    draw = ImageDraw.Draw(screen)
    def text(value, x, y, size, color):
        for index, character in enumerate(value):
            glyph = FONT[ord(character) * 5:ord(character) * 5 + 5]
            for column, bits in enumerate(glyph):
                for row in range(8):
                    if bits & (1 << row):
                        px, py = x + (index * 6 + column) * size, y + row * size
                        draw.rectangle((px, py, px + size - 1, py + size - 1), fill=rgb565(color))
    if palette['border']:
        draw.rounded_rectangle((1, 1, 168, 318), radius=4, outline=rgb565(muted))
    text('BRUCE / APPS' if name == 'home' else 'BRUCE / MENU', 14, 14, 1, muted)
    text('87%', 132, 14, 1, muted)
    size = 2 if len(title) <= 11 else 1
    text(title[:142 // (6 * size)], 14, 37, size, foreground)
    rows = min(len(labels), 6)
    start = max(0, min(selected - rows // 2, len(labels) - rows))
    for row in range(rows):
        index, y = start + row, 78 + row * 34
        if index == selected:
            draw.rounded_rectangle((3, y + 1, 5, y + 19), radius=1, fill=rgb565(accent))
        label = labels[index] if len(labels[index]) <= 11 else labels[index][:9] + '..'
        text(label, 14, y, 2, accent if index == selected else foreground)
    if len(labels) > rows:
        height = rows * 34 - 12
        thumb = max(6, height * rows // len(labels))
        y = 78 + (height - thumb) * selected // (len(labels) - 1)
        draw.rectangle((165, 78, 165, 78 + height - 1), fill=rgb565(muted))
        draw.rounded_rectangle((164, y, 166, y + thumb - 1), radius=1, fill=rgb565(accent))
    text('TURN / PRESS', 14, 300, 1, muted)
    position = f'{selected + 1}/{len(labels)}'
    text(position, 162 - len(position) * 6, 300, 1, muted)
    screen.resize((510, 960), Image.Resampling.NEAREST).save(OUT / f'{name}.png')

if __name__ == '__main__':
    preview('home', 'Explore', ['WiFi', 'Bluetooth', 'RF', 'NRF24', 'LoRa', 'IR', 'Ethernet', 'GPS', 'RFID', 'Files', 'Scripts', 'Clock', 'Others', 'Config'], 5)
    preview('settings', 'Display & UI', ['Brightness', 'Dim Time', 'Orientation', 'UI Color', 'UI Theme', 'Back'], 2)
