/* Nail Salon Price Estimator — Client-side logic */

const CORE_ADDONS_INFO = {
  extra_length: "Extra length — nail tips or extensions applied",
  specialty_shape: "Specialty shape (stiletto, almond, coffin, etc.)",
  rhinestones: "Rhinestones / crystals",
  charms: "Charms / 3D embellishments",
  studs: "Studs / metal accents",
  foil: "Foil application",
  flocking: "Flocking / velvet texture",
  chrome: "Chrome / mirror powder finish",
  nail_art_accent: "Accent nail art",
  repairs: "Nail repair (for damaged nails)",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fileInput = $("#file-input");
const dropZone = $("#drop-zone");
const preview = $("#preview");
const browseBtn = $("#browse-btn");
const analyzeBtn = $("#analyze-btn");
const resetBtn = $("#reset-btn");
const uploadContent = dropZone.querySelector(".upload-content");

browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

// Drag & drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    showError("Invalid File", "Please upload an image (JPG, PNG, WebP).");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = "block";
    uploadContent.style.display = "none";
    analyzeBtn.style.display = "block";
    resetBtn.style.display = "block";
  };
  reader.readAsDataURL(file);
}

function resetAll() {
  fileInput.value = "";
  preview.src = "";
  preview.style.display = "none";
  uploadContent.style.display = "";
  analyzeBtn.style.display = "none";
  resetBtn.style.display = "none";
  hideAllSections("upload-section");
}

analyzeBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  showSection("loading-section");
  analyzeBtn.disabled = true;

  const formData = new FormData();
  formData.append("image", file);

  try {
    const res = await fetch("/analyze", { method: "POST", body: formData });

    // Handle HTTP errors
    if (res.status === 413) {
      showError("File Too Large", "Please upload an image under 16MB.");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError("Error", data.error || "Something went wrong. Please try again.");
      return;
    }

    const data = await res.json();

    if (data.status === "error") {
      showSection("error-section");
      if (data.error_type === "not_nails") {
        $("#error-title").textContent = "Not a Nail Photo";
      } else if (data.error_type === "low_confidence") {
        $("#error-title").textContent = "Unclear Image";
      } else {
        $("#error-title").textContent = "Unable to Estimate";
      }
      $("#error-message").textContent = data.message;
    } else if (data.status === "success") {
      showResult(data);
    }
  } catch (err) {
    showError("Connection Error", "Could not reach the server. Please check your connection.");
  } finally {
    analyzeBtn.disabled = false;
  }
});

function showResult(data) {
  const est = data.estimate;

  // Complexity badge
  const badge = $("#result-badge");
  if (est.complexity_label.includes("Level 1")) {
    badge.className = "badge badge-level1";
    badge.textContent = "Simple";
  } else if (est.complexity_label.includes("Level 2")) {
    badge.className = "badge badge-level2";
    badge.textContent = "Medium";
  } else if (est.complexity_label.includes("Level 3")) {
    badge.className = "badge badge-level3";
    badge.textContent = "Complex";
  } else {
    badge.className = "badge badge-custom";
    badge.textContent = "Custom";
  }

  // Price
  let priceText = `$${est.price_min} – $${est.price_max}`;
  if (data.custom_required) {
    priceText = `$${est.price_min}+ (Custom Quote)`;
  }
  $("#result-price").textContent = priceText;

  // Complexity description
  $("#result-complexity").textContent = est.complexity_desc;

  // Details
  const details = $("#result-details");
  let html = `<p><strong>Base:</strong> ${est.base_type.charAt(0).toUpperCase() + est.base_type.slice(1)} | <strong>Set:</strong> ${est.set_type === "full_set" ? "Full Set (10 nails)" : "Partial Set"}</p>`;

  if (est.confidence) {
    html += `<p style="font-size:.8rem;color:var(--text-muted)">AI Confidence: ${Math.round(est.confidence * 100)}%</p>`;
  }

  if (est.visual_breakdown) {
    html += `<p style="margin-top:8px;font-style:italic">"${est.visual_breakdown}"</p>`;
  }

  details.innerHTML = html;

  // Add-ons
  const addonsSection = $("#result-addons");
  const addonsList = $("#addons-list");
  if (est.add_ons_applied && est.add_ons_applied.length > 0) {
    addonsSection.style.display = "block";
    addonsList.innerHTML = est.add_ons_applied
      .map((a) => `<li>${a}</li>`)
      .join("");
  } else {
    addonsSection.style.display = "none";
  }

  // Notes (capped / custom / included)
  const notes = $("#result-notes");
  let noteHTML = `<strong>Included:</strong> ${est.included.join(", ")}.<br><br>`;

  if (data.custom_required) {
    notes.className = "result-notes custom-note";
    noteHTML += `<strong>Custom Pricing Required:</strong> This design exceeds standard pricing tiers. Final price will be determined by your artist in person.`;
  } else if (data.capped) {
    notes.className = "result-notes capped-note";
    noteHTML += `<strong>Capped at maximum:</strong> The upper estimate has been capped at our maximum standard price. Additional complexity may require a custom quote.`;
  } else {
    notes.className = "result-notes";
    noteHTML += "Additional charges apply for extra length, specialty shapes, embellishments, and nail repairs — assessed in person.";
  }

  notes.innerHTML = noteHTML;

  // Disclaimer
  $("#disclaimer-text").textContent = data.disclaimer;

  showSection("result-section");
}

function showError(title, msg) {
  $("#error-title").textContent = title;
  $("#error-message").textContent = msg;
  showSection("error-section");
}

function hideAllSections(except) {
  ["upload-section", "loading-section", "result-section", "error-section"].forEach((id) => {
    $(`#${id}`).style.display = id === except ? "" : "none";
  });
}

function showSection(id) {
  hideAllSections(id);
}
