# Animation validation fixtures

`animated.png` and `animated.webp` are original two-frame, 2×2-pixel test images: a solid red frame followed by a solid blue frame. They are dedicated to the public domain under CC0, like the bundled starter artwork. No outside media was used.

Regenerate with Python and Pillow:

```python
from PIL import Image
from pathlib import Path

out = Path("src-tauri/tests/fixtures")
red = Image.new("RGBA", (2, 2), "red")
blue = Image.new("RGBA", (2, 2), "blue")
red.save(out / "animated.png", save_all=True, append_images=[blue], duration=100, loop=0)
red.save(out / "animated.webp", save_all=True, append_images=[blue], duration=100, loop=0, lossless=True)
```

These real encoded animations verify that import rejects unsupported animation instead of silently reducing it to a static image.
