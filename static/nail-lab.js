/* Nail Lab — Hand Builder Engine */

// ─── DOM refs ───
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const canvas = $("#hand-canvas");
const ctx = canvas.getContext("2d");
const uploadBox = $("#upload-box");
const fileInput = $("#nail-upload");
const stickerGrid = $("#sticker-grid");
const galleryGrid = $("#gallery-grid");
const dropZonesEl = $("#drop-zones");
const tonePicker = $("#tone-picker");
const shapeSelect = $("#nail-shape");
const btnExtract = $("#btn-extract");
const overlay = $("#overlay");
const overlayContent = $("#overlay-content");

let skinTone = "#fce4cc";
let nailShape = "round";
let stickers = [];        // { id, src, label, width, height }
let nailPlacements = [null, null, null, null, null]; // 5 fingers: thumb..pinky
let nextStickerId = 0;
let dragData = null;      // sticker being dragged
let dragGhost = null;
let canvasScale = 1;

// ─── Hand geometry (proportional to canvas) ───
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
const FINGERS_N = 5;

// Nail zones are percentages of the hand image
// Each: { top%, left%, width%, height%, rotation(deg) }
const NAIL_ZONES_BY_SHAPE = {
  round: [
    { t: 11, l: 15, w: 7.5, h: 4.5, r: -18 },  // thumb
    { t: 5,  l: 30, w: 6.5, h: 4.0, r: 0 },    // index
    { t: 3,  l: 47, w: 6.5, h: 4.2, r: 2 },    // middle
    { t: 5,  l: 65, w: 6.0, h: 3.8, r: 4 },    // ring
    { t: 9,  l: 81, w: 5.5, h: 3.4, r: 8 },    // pinky
  ],
  square: [
    { t: 11, l: 15, w: 7.5, h: 4.8, r: -18 },
    { t: 4,  l: 30, w: 6.5, h: 4.3, r: 0 },
    { t: 2,  l: 47, w: 6.5, h: 4.5, r: 2 },
    { t: 4,  l: 65, w: 6.0, h: 4.1, r: 4 },
    { t: 8,  l: 81, w: 5.5, h: 3.6, r: 8 },
  ],
  almond: [
    { t: 10, l: 15, w: 7.5, h: 5.5, r: -18 },
    { t: 3,  l: 30, w: 6.5, h: 5.2, r: 0 },
    { t: 1,  l: 47, w: 6.5, h: 5.5, r: 2 },
    { t: 3,  l: 65, w: 6.0, h: 5.0, r: 4 },
    { t: 7,  l: 81, w: 5.5, h: 4.5, r: 8 },
  ],
  stiletto: [
    { t: 9,  l: 15, w: 7.5, h: 7.0, r: -18 },
    { t: 2,  l: 30, w: 6.5, h: 6.5, r: 0 },
    { t: -1, l: 47, w: 6.5, h: 7.0, r: 2 },
    { t: 2,  l: 65, w: 6.0, h: 6.2, r: 4 },
    { t: 6,  l: 81, w: 5.5, h: 5.5, r: 8 },
  ],
  coffin: [
    { t: 10, l: 15, w: 7.5, h: 5.5, r: -18 },
    { t: 3,  l: 30, w: 6.5, h: 5.0, r: 0 },
    { t: 1,  l: 47, w: 6.5, h: 5.3, r: 2 },
    { t: 3,  l: 65, w: 6.0, h: 4.8, r: 4 },
    { t: 7,  l: 81, w: 5.5, h: 4.2, r: 8 },
  ],
};

function getNailZones() {
  return NAIL_ZONES_BY_SHAPE[nailShape] || NAIL_ZONES_BY_SHAPE.round;
}

// ─── Hand rendering ───
function drawHand() {
  const container = canvas.parentElement;
  const maxW = container.clientWidth * 0.9;
  const maxH = container.clientHeight * 0.85;

  if (canvas.width !== maxW || canvas.height !== maxH) {
    canvas.width = maxW;
    canvas.height = maxH;
    canvasScale = Math.max(maxW / 500, maxH / 380); // reference size
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Gradient background for depth
  const bg = ctx.createRadialGradient(w / 2, h * 0.35, h * 0.1, w / 2, h * 0.4, h * 0.8);
  bg.addColorStop(0, skinTone);
  bg.addColorStop(0.7, darken(skinTone, 0.15));
  bg.addColorStop(1, darken(skinTone, 0.30));

  // Palm
  ctx.fillStyle = bg;
  ctx.beginPath();
  const pw = w * 0.45;
  const ph = h * 0.8;
  const px = (w - pw) / 2;
  const py = h * 0.22;
  ctx.roundRect(px, py, pw, ph, Math.min(pw, ph) * 0.2);
  ctx.fill();

  // Fingers
  const fingers = getNailZones();
  const fingerW = w * 0.054;
  const fingerBaseY = h * 0.25;

  fingers.forEach((zone, i) => {
    const fx = w * (zone.l / 100);
    const fy = fingerBaseY;
    const fw = fingerW * (1 - i * 0.04);
    const fh = h * 0.32;

    ctx.save();
    ctx.translate(fx, fy + fh * 0.1);
    ctx.rotate((zone.r * Math.PI) / 180);
    ctx.translate(-fx, -(fy + fh * 0.1));

    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.roundRect(fx - fw / 2, fy - fh * 0.25, fw, fh, fw / 2);
    ctx.fill();

    // Shadow under nail
    const nz = getNailZoneAbs(i);
    if (nz && !nailPlacements[i]) {
      ctx.fillStyle = darken(skinTone, 0.25);
      ctx.beginPath();
      ctx.roundRect(nz.x, nz.y, nz.w, nz.h, nz.w * 0.4);
      ctx.fill();
    }

    ctx.restore();

    // Draw placed nail design
    if (nailPlacements[i] && nz) {
      const sticker = stickers.find((s) => s.id === nailPlacements[i]);
      if (sticker && sticker.img) {
        ctx.save();
        ctx.translate(nz.x + nz.w / 2, nz.y + nz.h / 2);
        ctx.rotate((zone.r * Math.PI) / 180);

        ctx.beginPath();
        ctx.roundRect(-nz.w / 2, -nz.h / 2, nz.w, nz.h, nz.w * 0.4);
        ctx.clip();

        ctx.drawImage(sticker.img, -nz.w / 2, -nz.h / 2, nz.w, nz.h);

        // Subtle gloss overlay
        const gloss = ctx.createLinearGradient(-nz.w / 2, -nz.h / 2, -nz.w / 2, nz.h / 2);
        gloss.addColorStop(0, "rgba(255,255,255,0.25)");
        gloss.addColorStop(0.4, "rgba(255,255,255,0.05)");
        gloss.addColorStop(1, "rgba(0,0,0,0.08)");
        ctx.fillStyle = gloss;
        ctx.fillRect(-nz.w / 2, -nz.h / 2, nz.w, nz.h);

        ctx.restore();
      }
    }

    // Knockout stroke for definition
    if (nz) {
      ctx.strokeStyle = "rgba(0,0,0,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(nz.x, nz.y, nz.w, nz.h, nz.w * 0.4);
      ctx.stroke();
    }
  });

  // Knuckle lines
  ctx.strokeStyle = darken(skinTone, 0.12);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(w * 0.16, h * 0.36);
  ctx.lineTo(w * 0.84, h * 0.36);
  ctx.stroke();
  ctx.setLineDash([]);

  updateDropZones();
}

function getNailZoneAbs(i) {
  const zones = getNailZones();
  if (i < 0 || i >= zones.length) return null;
  const z = zones[i];
  return {
    x: canvas.width * (z.l / 100) - (canvas.width * z.w / 200),
    y: canvas.height * (z.t / 100) - (canvas.height * z.h / 200),
    w: canvas.width * (z.w / 100),
    h: canvas.height * (z.h / 100),
  };
}

// ─── Drop zones (HTML overlays for drag events) ───
function updateDropZones() {
  dropZonesEl.innerHTML = "";

  getNailZones().forEach((zone, i) => {
    const nz = getNailZoneAbs(i);
    if (!nz) return;

    const el = document.createElement("div");
    el.className = "drop-zone";
    el.style.left = (zone.l - zone.w / 2) + "%";
    el.style.top = (zone.t - zone.h / 2) + "%";
    el.style.width = zone.w + "%";
    el.style.height = zone.h + "%";
    el.style.transform = `rotate(${zone.r}deg)`;
    el.dataset.finger = i;

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("hover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("hover"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("hover");
      const stickerId = e.dataTransfer.getData("text/sticker-id");
      if (stickerId) {
        nailPlacements[parseInt(i)] = parseInt(stickerId);
        drawHand();
      }
    });

    // Tap to remove
    el.addEventListener("click", () => {
      if (nailPlacements[i]) {
        nailPlacements[i] = null;
        drawHand();
      }
    });

    if (nailPlacements[i]) el.classList.add("filled");
    dropZonesEl.appendChild(el);
  });
}

// ─── Stickers ───
function addSticker(src, label = "") {
  const img = new Image();
  img.onload = () => {
    const sticker = { id: nextStickerId++, src, label, img, width: img.width, height: img.height };
    stickers.push(sticker);
    renderStickers();
    btnExtract.disabled = false;
  };
  img.src = src;
}

function removeSticker(id) {
  stickers = stickers.filter((s) => s.id !== id);
  nailPlacements = nailPlacements.map((p) => (p === id ? null : p));
  renderStickers();
  drawHand();
  if (stickers.length === 0) btnExtract.disabled = true;
}

function renderStickers() {
  stickerGrid.innerHTML = "";

  stickers.forEach((s) => {
    const el = document.createElement("div");
    el.className = "sticker";
    el.draggable = true;

    el.innerHTML = `
      <img src="${s.src}" alt="${s.label}">
      <button class="delete-sticker" data-id="${s.id}">&times;</button>
    `;

    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/sticker-id", String(s.id));
      el.style.opacity = "0.4";
    });
    el.addEventListener("dragend", () => {
      el.style.opacity = "1";
    });

    el.querySelector(".delete-sticker").addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeSticker(s.id);
    });

    el.addEventListener("click", () => {
      overlayContent.innerHTML = `
        <img src="${s.src}" alt="Full view">
        <button class="btn btn-outline close-overlay" onclick="document.getElementById('overlay').classList.remove('show')">Close</button>
      `;
      overlay.classList.add("show");
    });

    stickerGrid.appendChild(el);
  });
}

// ─── Upload handling ───
uploadBox.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  handleFiles(Array.from(e.target.files));
  fileInput.value = "";
});

uploadBox.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadBox.classList.add("dragover");
});
uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("dragover"));
uploadBox.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadBox.classList.remove("dragover");
  handleFiles(Array.from(e.dataTransfer.files));
});

function handleFiles(files) {
  files.forEach((file) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => addSticker(e.target.result, file.name);
    reader.readAsDataURL(file);
  });
}

// ─── Skin tone ───
tonePicker.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    tonePicker.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    skinTone = btn.dataset.tone;
    drawHand();
  });
});

// ─── Nail shape ───
shapeSelect.addEventListener("change", () => {
  nailShape = shapeSelect.value;
  drawHand();
});

// ─── Toolbar ───
$("#btn-clear").addEventListener("click", () => {
  nailPlacements = [null, null, null, null, null];
  drawHand();
});

$("#btn-export").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "nail-design.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

$("#btn-save").addEventListener("click", () => {
  const dataUrl = canvas.toDataURL("image/png");
  const looks = JSON.parse(localStorage.getItem("nail-lab-looks") || "[]");
  looks.push({ date: new Date().toISOString(), dataUrl });
  // Keep last 20
  if (looks.length > 20) looks.shift();
  localStorage.setItem("nail-lab-looks", JSON.stringify(looks));
  renderGallery();
});

// ─── Gallery ───
function renderGallery() {
  const looks = JSON.parse(localStorage.getItem("nail-lab-looks") || "[]");
  galleryGrid.innerHTML = "";

  if (looks.length === 0) {
    galleryGrid.innerHTML = '<p class="empty">No saved looks yet.<br>Create one and hit Save!</p>';
    return;
  }

  looks.reverse().forEach((look, i) => {
    const el = document.createElement("div");
    el.className = "gallery-item";

    const idx = looks.length - 1 - i;
    el.innerHTML = `
      <img src="${look.dataUrl}" alt="Saved look">
      <button class="delete-saved" data-idx="${idx}">×</button>
    `;

    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("delete-saved")) return;
      overlayContent.innerHTML = `
        <img src="${look.dataUrl}" alt="Saved look">
        <button class="btn btn-outline close-overlay" onclick="document.getElementById('overlay').classList.remove('show')">Close</button>
      `;
      overlay.classList.add("show");
    });

    el.querySelector(".delete-saved").addEventListener("click", (e) => {
      e.stopPropagation();
      const looksAll = JSON.parse(localStorage.getItem("nail-lab-looks") || "[]");
      looksAll.splice(parseInt(e.target.dataset.idx), 1);
      localStorage.setItem("nail-lab-looks", JSON.stringify(looksAll));
      renderGallery();
    });

    galleryGrid.appendChild(el);
  });
}

// ─── Overlay close ───
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.remove("show");
});

// ─── AI Extraction ───
btnExtract.addEventListener("click", async () => {
  if (stickers.length === 0) return;

  const sticker = stickers[stickers.length - 1];
  btnExtract.disabled = true;
  btnExtract.textContent = "Analyzing...";

  try {
    const res = await fetch("/extract-nails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: sticker.src }),
    });

    if (!res.ok) throw new Error("Extraction failed");
    const data = await res.json();

    if (data.nails && data.nails.length > 0) {
      data.nails.forEach((nail) => {
        const img = new Image();
        img.onload = () => {
          const id = nextStickerId++;
          stickers.push({ id, src: nail.data_url, label: nail.label || "Extracted", img });
          renderStickers();
        };
        img.src = nail.data_url;
      });
    }
  } catch (err) {
    alert("AI extraction failed. Try a clearer photo of nails against a plain background.");
  } finally {
    btnExtract.disabled = false;
    btnExtract.innerHTML = '<span class="sparkle">✦</span> Auto-extract nails from photo';
  }
});

// ─── Window resize ───
let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(drawHand, 200);
});

// ─── Helper ───
function darken(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.min(255, (num & 0xff) * (1 - amount)));
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// CanvasRenderingContext2D.roundRect polyfill
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (typeof r === "number") r = { tl: r, tr: r, br: r, bl: r };
    this.beginPath();
    this.moveTo(x + r.tl, y);
    this.lineTo(x + w - r.tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    this.lineTo(x + w, y + h - r.br);
    this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    this.lineTo(x + r.bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    this.lineTo(x, y + r.tl);
    this.quadraticCurveTo(x, y, x + r.tl, y);
    this.closePath();
    return this;
  };
}

// ─── Start ───
drawHand();
renderGallery();
