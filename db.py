"""
Nail Art Pinterest — Database models
"""

import os
import sqlite3
from datetime import datetime, timezone
from flask import g, current_app
from pathlib import Path


DB_DIR = Path(__file__).parent / "instance"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "nails.db"
UPLOAD_DIR = Path(__file__).parent / "static" / "uploads" / "nails"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(str(DB_PATH))
    with current_app.open_resource("schema.sql") as f:
        db.executescript(f.read().decode("utf8"))
    db.close()


def seed_demo_data():
    """Populate with sample nail art entries."""
    import random

    categories = [
        "French Tip",
        "Glitter",
        "Ombre",
        "Acrylic",
        "Gel",
        "Minimalist",
        "Floral",
        "Chrome",
        "Abstract",
        "Wedding",
        "Matte",
        "3D Art",
        "Holographic",
        "Animal Print",
        "Geometric",
        "Marble",
        "Neon",
        "Pastel",
        "Nude",
        "Red",
    ]

    demos = [
        ("Classic Almond French", "Timeless nude base with crisp white tips on almond-shaped nails.", "French Tip", "french"),
        ("Rose Gold Glitter Ombre", "Sparkling rose gold glitter fading into a soft pink base.", "Glitter", "glitter"),
        ("Soft Pink Ombre", "Gentle gradient from blush to barely-there pink.", "Ombre", "ombre"),
        ("Crystal Clear Acrylics", "Long, square acrylics with a glass-like transparent finish.", "Acrylic", "acrylic"),
        ("Milky White Gel Set", "Short, round gel nails in an elegant milky white.", "Gel", "gel"),
        ("Single Line Minimalist", "Clean nude nails with one thin black vertical line.", "Minimalist", "minimal"),
        ("Hand-Painted Florals", "Delicate watercolor flowers on a blush pink base.", "Floral", "floral"),
        ("Mirror Chrome Stilettos", "High-shine silver chrome on sharp stiletto nails.", "Chrome", "chrome"),
        ("Abstract Swirl Art", "Bold teal, gold, and white swirled together.", "Abstract", "abstract"),
        ("Pearl & Lace Wedding Set", "Ivory nails with pearl accents and micro-lace details.", "Wedding", "wedding"),
        ("Deep Burgundy Matte", "Rich wine-red matte finish on coffin nails.", "Matte", "matte"),
        ("3D Daisy Charms", "Yellow and white 3D daisies on a sage green base.", "3D Art", "3d"),
        ("Holographic Butterfly", "Rainbow holographic base with tiny butterfly decals.", "Holographic", "holo"),
        ("Leopard Print Accent", "Classic leopard print on two accent nails, nude on the rest.", "Animal Print", "animal"),
        ("Gold Geometric Lines", "Nude base with thin gold foil geometric patterns.", "Geometric", "geo"),
        ("Black & White Marble", "Swirled marble effect with gold vein detailing.", "Marble", "marble"),
        ("Electric Neon Tips", "Bright neon yellow French tips on a clear base.", "Neon", "neon"),
        ("Lavender Pastel Dreams", "Soft lavender with white cloud accents.", "Pastel", "pastel"),
        ("Nude Perfection", "Your-nails-but-better sheer nude on almond shapes.", "Nude", "nude"),
        ("Classic Red Gloss", "High-gloss pillar-box red on square nails.", "Red", "red"),
    ]

    db = sqlite3.connect(str(DB_PATH))
    cursor = db.cursor()

    for title, desc, category, slug in demos:
        cursor.execute("""
            INSERT OR IGNORE INTO nails (title, description, category, image_path, likes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (title, desc, category, f"/static/nails/{slug}.svg", random.randint(12, 250), datetime.now(timezone.utc).isoformat()))

    db.commit()
    db.close()


CATEGORY_COLORS = {
    "French Tip": "#e8c4a0",
    "Glitter": "#f4d03f",
    "Ombre": "#d7bde2",
    "Acrylic": "#a9cce3",
    "Gel": "#fadbd8",
    "Minimalist": "#d5dbdb",
    "Floral": "#f5b7b1",
    "Chrome": "#aeb6bf",
    "Abstract": "#85c1e9",
    "Wedding": "#fdfefe",
    "Matte": "#c0392b",
    "3D Art": "#82e0aa",
    "Holographic": "#d2b4de",
    "Animal Print": "#edbb99",
    "Geometric": "#f9e79f",
    "Marble": "#f2f3f4",
    "Neon": "#a3e4d7",
    "Pastel": "#d6eaf8",
    "Nude": "#e6b0aa",
    "Red": "#f1948a",
}
