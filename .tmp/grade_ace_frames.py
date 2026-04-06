from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "meridian" / "assets"

FRAME_NAMES = [
    "ace-face-render.png",
    "ace-face-viseme-jaw.png",
    "ace-face-viseme-oo.png",
    "ace-face-viseme-ee.png",
    "ace-face-focus-brow.png",
    "ace-face-serene-smile.png",
]


def ellipse_mask(size: tuple[int, int], box: tuple[float, float, float, float], blur: float, level: int = 255) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse(tuple(int(v) for v in box), fill=level)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def limited(mask: Image.Image, factor: float) -> Image.Image:
    return mask.point(lambda v: max(0, min(255, int(v * factor))))


def grade_frame(name: str) -> None:
    image = Image.open(ASSETS / name).convert("RGBA")
    alpha = image.getchannel("A")
    rgb = image.convert("RGB")

    rgb = ImageEnhance.Contrast(rgb).enhance(1.18)
    rgb = ImageEnhance.Brightness(rgb).enhance(0.90)

    luma = ImageOps.grayscale(rgb)
    shadows = ImageOps.invert(ImageOps.autocontrast(luma)).filter(ImageFilter.GaussianBlur(18))
    highlights = ImageOps.autocontrast(luma).filter(ImageFilter.GaussianBlur(14))

    shadow_tone = Image.new("RGB", rgb.size, (132, 150, 178))
    rgb = Image.composite(ImageChops.multiply(rgb, shadow_tone), rgb, limited(shadows, 0.30))

    cool_plate = Image.new("RGB", rgb.size, (226, 236, 248))
    rgb = Image.composite(ImageChops.screen(rgb, cool_plate), rgb, limited(highlights, 0.12))

    eye_mask_left = ellipse_mask(rgb.size, (rgb.width * 0.34, rgb.height * 0.36, rgb.width * 0.45, rgb.height * 0.45), 22)
    eye_mask_right = ellipse_mask(rgb.size, (rgb.width * 0.55, rgb.height * 0.36, rgb.width * 0.66, rgb.height * 0.45), 22)
    eye_mask = ImageChops.lighter(eye_mask_left, eye_mask_right)
    eye_mask = ImageChops.multiply(eye_mask, alpha)
    eye_tone = Image.new("RGB", rgb.size, (28, 34, 46))
    rgb = Image.composite(ImageChops.multiply(rgb, eye_tone), rgb, limited(eye_mask, 0.26))

    jaw_shadow = ellipse_mask(rgb.size, (rgb.width * 0.24, rgb.height * 0.66, rgb.width * 0.78, rgb.height * 0.95), 56)
    jaw_shadow = ImageChops.multiply(jaw_shadow, alpha)
    jaw_tone = Image.new("RGB", rgb.size, (156, 166, 182))
    rgb = Image.composite(ImageChops.multiply(rgb, jaw_tone), rgb, limited(jaw_shadow, 0.22))

    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    out.save(ASSETS / name)


def main() -> None:
    for name in FRAME_NAMES:
        grade_frame(name)
    print("Graded Ace face frames")


if __name__ == "__main__":
    main()
