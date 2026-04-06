from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "meridian" / "assets"


def load_rgba(name: str) -> Image.Image:
    return Image.open(ASSETS / name).convert("RGBA")


def save_rgba(name: str, rgb: Image.Image, alpha: Image.Image) -> None:
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    out.save(ASSETS / name)


def white_rgba(mask: Image.Image, level: int = 255) -> Image.Image:
    rgb = Image.new("RGBA", mask.size, (level, level, level, 255))
    rgb.putalpha(mask)
    return rgb


def delta_mask(base: Image.Image, variant: Image.Image, blur: float, boost: float = 1.8) -> Image.Image:
    diff = ImageChops.difference(base.convert("RGB"), variant.convert("RGB")).convert("L")
    diff = ImageOps.autocontrast(diff)
    diff = diff.point(lambda v: max(0, min(255, int(v * boost))))
    return diff.filter(ImageFilter.GaussianBlur(blur))


def gradient_mask(size: tuple[int, int], start_y: float, end_y: float) -> Image.Image:
    width, height = size
    img = Image.new("L", size, 0)
    px = img.load()
    for y in range(height):
        if y <= start_y:
            value = 0
        elif y >= end_y:
            value = 255
        else:
            value = int(255 * ((y - start_y) / max(1, end_y - start_y)))
        for x in range(width):
            px[x, y] = value
    return img


def inverse_gradient_mask(size: tuple[int, int], start_y: float, end_y: float) -> Image.Image:
    return ImageOps.invert(gradient_mask(size, start_y, end_y))


def ellipse_mask(size: tuple[int, int], box: tuple[float, float, float, float], blur: float) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse(tuple(int(v) for v in box), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def composite_variant(base: Image.Image, variant: Image.Image, mask: Image.Image, output_name: str) -> None:
    alpha = base.getchannel("A")
    clipped_mask = ImageChops.multiply(mask, alpha)
    blended = Image.composite(variant, base, clipped_mask)
    blended.putalpha(alpha)
    blended.save(ASSETS / output_name)


def main() -> None:
    base = load_rgba("ace-face-render.png")
    jaw = load_rgba("ace-face-viseme-jaw.png")
    oo = load_rgba("ace-face-viseme-oo.png")
    ee = load_rgba("ace-face-viseme-ee.png")
    focus = load_rgba("ace-face-focus-brow.png")
    smile = load_rgba("ace-face-serene-smile.png")

    alpha = base.getchannel("A")
    mouth_ellipse = ellipse_mask(base.size, (base.width * 0.26, base.height * 0.48, base.width * 0.74, base.height * 0.84), 36)
    oo_ellipse = ellipse_mask(base.size, (base.width * 0.31, base.height * 0.58, base.width * 0.69, base.height * 0.82), 26)
    jaw_ellipse = ellipse_mask(base.size, (base.width * 0.22, base.height * 0.42, base.width * 0.78, base.height * 0.92), 42)
    brow_ellipse = ellipse_mask(base.size, (base.width * 0.16, base.height * 0.10, base.width * 0.84, base.height * 0.48), 40)

    composite_variant(base, jaw, jaw_ellipse, "ace-face-viseme-jaw.png")
    composite_variant(base, oo, oo_ellipse, "ace-face-viseme-oo.png")
    composite_variant(base, ee, mouth_ellipse, "ace-face-viseme-ee.png")
    composite_variant(base, focus, brow_ellipse, "ace-face-focus-brow.png")
    composite_variant(base, smile, mouth_ellipse, "ace-face-serene-smile.png")

    jaw = load_rgba("ace-face-viseme-jaw.png")
    oo = load_rgba("ace-face-viseme-oo.png")
    ee = load_rgba("ace-face-viseme-ee.png")
    focus = load_rgba("ace-face-focus-brow.png")

    alpha_soft = alpha.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(24))
    white_rgba(alpha_soft, 242).save(ASSETS / "ace-face-alpha.png")

    base_luma = ImageOps.autocontrast(base.convert("L").filter(ImageFilter.GaussianBlur(10)))
    depth_rgb = Image.merge("RGB", (base_luma, base_luma, base_luma))
    depth_alpha = alpha.filter(ImageFilter.GaussianBlur(6))
    save_rgba("ace-face-depth.png", depth_rgb, depth_alpha)

    highlight = ImageChops.subtract(base.convert("L"), base.convert("L").filter(ImageFilter.GaussianBlur(18)))
    highlight = ImageOps.autocontrast(highlight).point(lambda v: 255 if v > 158 else int(max(0, v * 1.75)))
    highlight = highlight.filter(ImageFilter.GaussianBlur(3))
    white_rgba(ImageChops.multiply(highlight, alpha), 255).save(ASSETS / "ace-face-specular.png")

    mouth_delta = delta_mask(base, jaw, blur=10, boost=2.6)
    mouth_delta = ImageChops.lighter(mouth_delta, delta_mask(base, oo, blur=10, boost=2.4))
    mouth_delta = ImageChops.lighter(mouth_delta, delta_mask(base, ee, blur=10, boost=2.4))
    mouth_window = gradient_mask(base.size, base.height * 0.42, base.height * 0.62)
    mouth_window = ImageChops.multiply(mouth_window, inverse_gradient_mask(base.size, base.height * 0.78, base.height * 0.93))
    mouth_mask = ImageChops.multiply(mouth_delta, mouth_window)
    mouth_mask = ImageChops.multiply(mouth_mask, alpha)
    white_rgba(mouth_mask.filter(ImageFilter.GaussianBlur(4)), 235).save(ASSETS / "ace-face-mouth-mask.png")

    focus_delta = delta_mask(base, focus, blur=18, boost=2.1)
    upper_window = inverse_gradient_mask(base.size, base.height * 0.42, base.height * 0.58)
    focus_mask = ImageChops.multiply(focus_delta, upper_window)
    focus_mask = ImageChops.lighter(
        focus_mask,
        ImageChops.multiply(alpha.filter(ImageFilter.GaussianBlur(28)), inverse_gradient_mask(base.size, base.height * 0.34, base.height * 0.52)),
    )
    focus_mask = ImageOps.autocontrast(focus_mask).point(lambda v: int(v * 0.78))
    white_rgba(focus_mask, 240).save(ASSETS / "ace-face-focus-mask.png")

    print("Built auxiliary Ace passes")


if __name__ == "__main__":
    main()
