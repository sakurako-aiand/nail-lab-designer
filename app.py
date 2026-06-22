"""
Nail Salon AI Price Estimator
Flask backend with multimodal AI image analysis and rule-based price estimation.
"""

import base64
import io
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from PIL import Image

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB max upload

BASE_DIR = Path(__file__).parent
PRICELIST_PATH = BASE_DIR / "pricelist.yaml"
LOG_PATH = BASE_DIR / "estimates_log.jsonl"
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO)


# ---------------------------------------------------------------------------
# Price list loader
# ---------------------------------------------------------------------------

def load_pricelist() -> dict:
    with open(PRICELIST_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Request logger (JSONL for easy analytics)
# ---------------------------------------------------------------------------

def log_estimate(entry: dict) -> None:
    entry["id"] = str(uuid.uuid4())[:8]
    entry["timestamp"] = datetime.now(timezone.utc).isoformat()
    with open(LOG_PATH, "a") as f:
        f.write(json.dumps(entry, default=str) + "\n")


# ---------------------------------------------------------------------------
# Price rule engine
# ---------------------------------------------------------------------------

def compute_price(analysis: dict) -> dict:
    """
    Given the AI's structured analysis of the image, apply the price list
    rules to produce a min/max estimate range and a breakdown.
    """
    pricelist = load_pricelist()

    complexity_key = analysis.get("complexity", "level_2_medium")
    complexity = pricelist["complexity_levels"].get(
        complexity_key, pricelist["complexity_levels"]["level_2_medium"]
    )

    base_min = complexity["base_price_min"]
    base_max = complexity["base_price_max"]

    addons_total_min = 0
    addons_total_max = 0
    addon_details = []
    included = [complexity["label"]]

    # Base type
    base_type = analysis.get("base_type", "gel")
    bt = pricelist["base_types"].get(base_type)
    if bt and not bt.get("included_in_base", False) and "price" in bt:
        addons_total_min += bt["price"]
        addons_total_max += bt["price"]
        addon_details.append(bt["label"])
    if bt:
        included.append(bt["label"])

    # Set type
    set_type = analysis.get("set_type", "full_set")
    st = pricelist["set_types"].get(set_type)
    if st:
        included.append(st["label"])

    # Add-ons
    addons = analysis.get("add_ons", {})
    ao_defs = pricelist["add_ons"]

    for key, enabled in addons.items():
        if not enabled:
            continue
        ao = ao_defs.get(key)
        if not ao:
            continue

        if "price_per_item" in ao:
            count = enabled if isinstance(enabled, int) else 1
            addons_total_min += ao["price_per_item"] * count
            addons_total_max += ao["price_per_item"] * count
            addon_details.append(f"{ao['label']} (×{count})")
        elif "price" in ao:
            addons_total_min += ao["price"]
            addons_total_max += ao["price"]
            addon_details.append(ao["label"])

    # "Full Art Upgrade" if every nail has different intricate design
    if analysis.get("full_art_upgrade", False):
        art = ao_defs.get("nail_art_full")
        if art:
            addons_total_min += art["price"]
            addons_total_max += art["price"]
            addon_details.append(art["label"])

    # Accent nails beyond the 2 included
    accent_count = analysis.get("accent_nails", 0)
    if accent_count > 2:
        extra_accents = accent_count - 2
        acc = ao_defs.get("nail_art_accent", {})
        if acc:
            addons_total_min += acc.get("price_per_nail", 5) * extra_accents
            addons_total_max += acc.get("price_per_nail", 5) * extra_accents
            addon_details.append(f"{extra_accents} Extra Accent Nails")

    # Partial set discount
    if set_type == "partial_set":
        discount_pct = st.get("discount_percent", 20) / 100.0
        base_min = round(base_min * (1 - discount_pct))
        base_max = round(base_max * (1 - discount_pct))

    estimate_min = base_min + addons_total_min
    estimate_max = base_max + addons_total_max

    # Cap at salon max
    salon_max = pricelist.get("salon", {}).get("max_price", 95)
    capped = False
    custom_required = False

    if estimate_min > salon_max:
        custom_required = True
        estimate_min = salon_max
        estimate_max = salon_max + 15
    elif estimate_max > salon_max:
        estimate_max = salon_max
        capped = True

    return {
        "estimate_min": estimate_min,
        "estimate_max": estimate_max,
        "complexity_label": complexity["label"],
        "complexity_desc": complexity["description"],
        "base_type": base_type,
        "set_type": set_type,
        "included": included,
        "add_ons_applied": addon_details,
        "capped": capped,
        "custom_required": custom_required,
        "confidence": analysis.get("confidence", 0.85),
        "disclaimer": pricelist.get(
            "disclaimer",
            "This is an AI estimate. Final price will be confirmed in person.",
        ),
    }


# ---------------------------------------------------------------------------
# AI Image Analysis
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a nail salon pricing assistant. Analyze the uploaded image and return a JSON object describing every visible nail design element.

Respond with ONLY valid JSON. No markdown, no explanation.

{
  "is_nails": true,
  "image_quality": "clear",
  "confidence": 0.85,
  "nail_count": 10,
  "set_type": "full_set",
  "complexity": "level_2_medium",
  "base_type": "gel",
  "accent_nails": 2,
  "full_art_upgrade": false,
  "add_ons": {
    "extra_length": false,
    "specialty_shape": false,
    "rhinestones": 0,
    "charms": 0,
    "studs": 0,
    "foil": false,
    "flocking": false,
    "chrome": false,
    "nail_art_accent": 0,
    "repairs": 0
  },
  "visual_description": "Short description of what you see"
}

RULES:
- is_nails: false if the image does not show fingernails or nail art (e.g., eye makeup, landscape, random object). If false, set image_quality to "not_nails" and confidence to 0.
- image_quality: "clear", "blurry", "partial", or "not_nails"
- confidence: 0.0 to 1.0. Use 0 if not_nails. Use 0.3-0.69 if image is too blurry to assess design. Use 0.7-0.85 for partial/moderate quality. Use 0.86-0.95 for clear images. Never use >0.95.
- nail_count: number of visible nails being shown in a set (typically 5 or 10)
- set_type: "full_set" for 10 nails, "partial_set" for fewer
- complexity:
  - "level_1_simple": single solid color, French tip, single glitter stripe, plain
  - "level_2_medium": two+ colors, simple patterns (checks, stripes), ombre/gradient, basic stamping
  - "level_3_complex": detailed hand-painting (florals, characters, portraits), 3D elements, chrome/mirror, intricate geometric patterns, multi-color gradients
  - "custom": 10 different designs per nail, extreme detail, celebrity-level art
- base_type: "gel", "acrylic", "dip_powder", or "natural"
- accent_nails: number of nails with a distinctly different design (ring fingers etc.)
- full_art_upgrade: true if every nail has a different intricate design
- add_ons: set integer counts for countable items (rhinestones, charms, studs, repairs, nail_art_accent). Set true/false for boolean items (extra_length, specialty_shape, foil, flocking, chrome).
  - extra_length: true if nails appear longer than natural nail bed
  - specialty_shape: true if shape is stiletto, almond, coffin/ballerina, or other non-basic shape
  - chrome: true if there is a chrome or mirror powder finish that looks metallic/reflective
"""


def analyze_image(image_data: bytes) -> dict:
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    encoded = base64.b64encode(image_data).decode("utf-8")

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Analyze this nail art image and return the JSON.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{encoded}",
                                "detail": "high",
                            },
                        },
                    ],
                },
            ],
            max_tokens=800,
            temperature=0.0,
        )

        raw = response.choices[0].message.content.strip()

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw[:-3]

        analysis = json.loads(raw)
        return analysis

    except (json.JSONDecodeError, Exception) as e:
        logging.error(f"AI analysis error: {e}")
        raise


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/nail-lab")
def nail_lab():
    return render_template("nail-lab.html")


@app.route("/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    image_data = file.read()
    if not image_data:
        return jsonify({"error": "Empty file"}), 400

    # Validate image format
    try:
        img = Image.open(io.BytesIO(image_data))
        img.verify()
    except Exception:
        return jsonify({"error": "Invalid image file"}), 400

    # Open fresh after verify()
    img = Image.open(io.BytesIO(image_data))

    # Resize large images to save API cost (max 2048px on longest side)
    max_dim = 2048
    if max(img.size) > max_dim:
        ratio = max_dim / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    image_data = buf.getvalue()

    # Save for audit
    filename = f"{uuid.uuid4().hex[:12]}.jpg"
    filepath = UPLOAD_DIR / filename
    img.save(filepath, "JPEG", quality=85)

    # --- AI Analysis ---
    try:
        analysis = analyze_image(image_data)
    except Exception as e:
        logging.error(f"OpenAI call failed: {e}")
        return jsonify({"error": "AI analysis failed. Please try again."}), 500

    # --- Error / Edge Cases ---
    if not analysis.get("is_nails", True):
        log_estimate(
            {
                "status": "rejected",
                "reason": "not_nails",
                "image": filename,
                "analysis": analysis,
            }
        )
        return jsonify(
            {
                "status": "error",
                "error_type": "not_nails",
                "message": "This image doesn't appear to show nail art. Please upload a photo of nails or nail designs.",
            }
        )

    quality = analysis.get("image_quality", "clear")
    confidence = analysis.get("confidence", 0.0)

    if quality == "blurry" or confidence < 0.7:
        log_estimate(
            {
                "status": "rejected",
                "reason": "low_confidence",
                "confidence": confidence,
                "image": filename,
                "analysis": analysis,
            }
        )
        return jsonify(
            {
                "status": "error",
                "error_type": "low_confidence",
                "confidence": confidence,
                "message": "I can't estimate this design accurately. Could you please upload a clearer photo or describe the desired style (e.g., simple, medium, complex)?",
            }
        )

    # --- Compute Price ---
    result = compute_price(analysis)

    # Log
    log_estimate(
        {
            "status": "estimated",
            "image": filename,
            "analysis": analysis,
            "result": result,
        }
    )

    return jsonify(
        {
            "status": "success",
            "estimate": {
                "price_min": result["estimate_min"],
                "price_max": result["estimate_max"],
                "complexity_label": result["complexity_label"],
                "complexity_desc": result["complexity_desc"],
                "base_type": result["base_type"],
                "set_type": result["set_type"],
                "included": result["included"],
                "add_ons_applied": result["add_ons_applied"],
                "capped": result["capped"],
                "custom_required": result["custom_required"],
                "confidence": result["confidence"],
                "visual_breakdown": analysis.get("visual_description", ""),
            },
            "disclaimer": result["disclaimer"],
            "capped": result["capped"],
            "custom_required": result["custom_required"],
        }
    )


# ─── Nail Lab: AI auto-extract individual nails from a photo ───

EXTRACT_SYSTEM_PROMPT = """You are a computer vision assistant for a nail design app. Analyze the uploaded image and identify individual fingernails.

The image may show one hand or multiple hands. For each visible nail plate, return bounding box coordinates and a description.

Respond with ONLY valid JSON:

{
  "nail_count": 5,
  "nails": [
    {
      "finger": "thumb",
      "bounds": {"x": 10, "y": 50, "width": 80, "height": 40},
      "shape": "round",
      "description": "pink gel with white French tip"
    }
  ]
}

RULES:
- bounds: pixel coordinates of the nail plate region. x and y are top-left corner.
- finger: which finger this nail is on ("thumb", "index", "middle", "ring", "pinky")
- shape: one of "round", "square", "almond", "stiletto", "coffin"
- Only include nails that are clearly visible and well-lit.
- If no nails are detectable, return {"nail_count": 0, "nails": []}
- Be precise with bounds — only capture the nail plate, not the finger skin."""


@app.route("/extract-nails", methods=["POST"])
def extract_nails():
    data = request.get_json()
    if not data or "image" not in data:
        return jsonify({"error": "No image data provided"}), 400

    image_b64 = data["image"]
    # Strip data URL prefix if present
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

        # First decode base64 to get the raw image for cropping
        raw_bytes = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(raw_bytes))

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Identify each visible nail plate in this image and return bounding box coordinates.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_b64}",
                                "detail": "high",
                            },
                        },
                    ],
                },
            ],
            max_tokens=600,
            temperature=0.0,
        )

        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw[:-3]

        result = json.loads(raw)

        nails = result.get("nails", [])
        if not nails:
            return jsonify({"nails": []})

        img_w, img_h = img.size
        extracted = []

        for nail in nails:
            bounds = nail.get("bounds", {})
            x = max(0, bounds.get("x", 0))
            y = max(0, bounds.get("y", 0))
            w = bounds.get("width", 50)
            h = bounds.get("height", 30)

            # Clamp to image bounds
            right = min(x + w, img_w)
            bottom = min(y + h, img_h)
            x = min(x, img_w - 1)
            y = min(y, img_h - 1)
            w = max(1, right - x)
            h = max(1, bottom - y)

            cropped = img.crop((x, y, x + w, y + h))

            # Resize to a standard nail sticker size
            cropped = cropped.resize((120, 160), Image.LANCZOS)

            buf = io.BytesIO()
            cropped.save(buf, format="PNG")
            cropped_b64 = base64.b64encode(buf.getvalue()).decode()

            extracted.append(
                {
                    "finger": nail.get("finger", "unknown"),
                    "shape": nail.get("shape", "round"),
                    "description": nail.get("description", ""),
                    "label": f"{nail.get('finger', 'nail').title()} — {nail.get('description', 'nail')}",
                    "data_url": f"data:image/png;base64,{cropped_b64}",
                }
            )

        return jsonify({"nails": extracted, "nail_count": len(extracted)})

    except (json.JSONDecodeError, Exception) as e:
        logging.error(f"Nail extraction error: {e}")
        return jsonify({"error": "Extraction failed", "nails": []}), 422


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
