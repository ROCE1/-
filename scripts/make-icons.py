"""生成占位图标：圆角深色方块 + 蓝色波纹。
不需要任何外部素材，改了颜色/字母重新跑一次即可。
运行： <runtime>/python/python.exe scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG_TOP = (30, 42, 64)
BG_BOTTOM = (15, 17, 21)
ACCENT = (76, 141, 255)
LIGHT = (230, 233, 239)


def rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        color = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = color
    return img


def draw_waves(img: Image.Image) -> None:
    size = img.size[0]
    draw = ImageDraw.Draw(img)
    steps = 3
    for index in range(steps):
        radius = size * (0.14 + index * 0.075)
        bbox = (
            size / 2 - radius,
            size * 0.60 - radius * 0.45,
            size / 2 + radius,
            size * 0.60 + radius * 0.45,
        )
        width = max(2, int(size * 0.022))
        alpha_color = ACCENT if index == 0 else LIGHT
        draw.arc(bbox, start=200, end=340, fill=alpha_color, width=width)
    eye = size * 0.035
    draw.ellipse(
        (size * 0.38 - eye, size * 0.42 - eye, size * 0.38 + eye, size * 0.42 + eye),
        fill=LIGHT,
    )


def build(size: int) -> Image.Image:
    base = gradient(size).convert("RGBA")
    draw_waves(base)
    base.putalpha(rounded_mask(size))
    return base


def main() -> None:
    icons_dir = ROOT / "www" / "icons"
    build_dir = ROOT / "build"
    icons_dir.mkdir(parents=True, exist_ok=True)
    build_dir.mkdir(parents=True, exist_ok=True)

    big = build(512)
    big.save(icons_dir / "icon-512.png")
    build(192).save(icons_dir / "icon-192.png")

    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    big.save(build_dir / "icon.ico", sizes=ico_sizes)
    big.save(build_dir / "icon.png")

    print("icons written:")
    for path in (icons_dir / "icon-512.png", icons_dir / "icon-192.png", build_dir / "icon.ico"):
        print(" ", path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
