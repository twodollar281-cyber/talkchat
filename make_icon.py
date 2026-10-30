from PIL import Image

src = Image.open("assets/icon-only.png").convert("RGBA")

sizes = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192
}

for density, size in sizes.items():
    folder = f"android/app/src/main/res/mipmap-{density}"
    img = src.resize((size, size), Image.Resampling.LANCZOS)

    for name in ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]:
        img.save(f"{folder}/{name}")

print("TalkChat ikonları dəyişdirildi!")
