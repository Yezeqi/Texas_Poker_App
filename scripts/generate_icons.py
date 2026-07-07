from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def scaled_box(values, scale):
    return tuple(int(value * scale) for value in values)


def font(size):
    try:
        return ImageFont.truetype("arialbd.ttf", size)
    except OSError:
        return ImageFont.load_default()


out = Path("public/icons")
out.mkdir(parents=True, exist_ok=True)

for size in (192, 512):
    scale = size / 512
    img = Image.new("RGBA", (size, size), "#141712")
    draw = ImageDraw.Draw(img)

    draw.ellipse(
        scaled_box((72, 162, 440, 406), scale),
        fill="#176044",
        outline="#8a5735",
        width=max(4, int(22 * scale)),
    )
    draw.rounded_rectangle(scaled_box((150, 136, 246, 272), scale), radius=int(14 * scale), fill="#f8f4e8")
    draw.rounded_rectangle(scaled_box((266, 118, 362, 254), scale), radius=int(14 * scale), fill="#f8f4e8")

    card_font = font(int(58 * scale))
    draw.text(scaled_box((177, 160), scale), "A", fill="#101010", font=card_font)
    draw.text(scaled_box((292, 142), scale), "K", fill="#b4202d", font=card_font)

    draw.ellipse(scaled_box((202, 274, 310, 382), scale), fill="#e2b653")
    dealer_font = font(int(58 * scale))
    bbox = draw.textbbox((0, 0), "D", font=dealer_font)
    draw.text(
        (size // 2 - (bbox[2] - bbox[0]) // 2, int(328 * scale) - (bbox[3] - bbox[1]) // 2),
        "D",
        fill="#141712",
        font=dealer_font,
    )

    img.save(out / f"icon-{size}.png")
