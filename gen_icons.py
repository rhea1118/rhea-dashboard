"""Generate PWA icons for Rhea Dashboard"""
from PIL import Image, ImageDraw, ImageFont
import math

def create_gradient(width, height, color1, color2):
    """Create a diagonal gradient image."""
    img = Image.new('RGBA', (width, height))
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            # Diagonal gradient
            t = (x + y) / (width + height)
            r = int(color1[0] + (color2[0] - color1[0]) * t)
            g = int(color1[1] + (color2[1] - color1[1]) * t)
            b = int(color1[2] + (color2[2] - color1[2]) * t)
            pixels[x, y] = (r, g, b, 255)
    return img

def create_icon(size, output_path):
    """Create a Rhea icon with gradient background and R letter."""
    # Colors: blue (#6B8AFE) to purple (#8B7FE8)
    color1 = (107, 138, 254)  # #6B8AFE
    color2 = (139, 127, 232)   # #8B7FE8
    
    # Create gradient background
    img = create_gradient(size, size, color1, color2)
    draw = ImageDraw.Draw(img)
    
    # Draw a subtle circle highlight in top-right
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    o_draw = ImageDraw.Draw(overlay)
    r = int(size * 0.3)
    cx, cy = int(size * 0.8), int(size * 0.2)
    for i in range(r, 0, -1):
        alpha = int(30 * (1 - i / r))
        o_draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(255, 255, 255, alpha))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)
    
    # Draw "R" letter
    font_size = int(size * 0.55)
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
    
    # Get text bounding box
    bbox = draw.textbbox((0, 0), "R", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) // 2 - bbox[0]
    y = (size - text_h) // 2 - bbox[1] - int(size * 0.03)
    
    # Draw text with slight shadow
    draw.text((x + 2, y + 2), "R", fill=(0, 0, 0, 40), font=font)
    draw.text((x, y), "R", fill=(255, 255, 255, 255), font=font)
    
    img.save(output_path, 'PNG')
    print(f"Generated: {output_path} ({size}x{size})")

if __name__ == '__main__':
    import os
    out_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(out_dir, exist_ok=True)
    create_icon(192, os.path.join(out_dir, 'icon-192.png'))
    create_icon(512, os.path.join(out_dir, 'icon-512.png'))
    print("Done!")
