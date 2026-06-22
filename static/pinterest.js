/* Nail Lab — Pinterest Discovery Feed */

const $ = (s) => document.querySelector(s);

let allNails = [];
let currentNails = [];
let activeCategory = "";
let searchQuery = "";
let sessionId = localStorage.getItem("nail-session") || crypto.randomUUID();
localStorage.setItem("nail-session", sessionId);
let likedIds = new Set(JSON.parse(localStorage.getItem("liked-nails") || "[]"));
let savedIds = new Set(JSON.parse(localStorage.getItem("saved-nails") || "[]"));

// ─── Fetch ───
async function loadNails() {
  try {
    const res = await fetch("/api/nails");
    allNails = await res.json();
    currentNails = [...allNails];
    render();
  } catch (e) {
    toast("Could not load nail art. Try refreshing.");
  }
}

// ─── Render Masonry ───
function render() {
  const grid = $("#masonry");

  if (currentNails.length === 0) {
    grid.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:40px;font-size:.9rem">No nail art found. Try another search or category.</p>`;
    $("#end-msg").style.display = "none";
    return;
  }

  grid.innerHTML = currentNails.map((n) => {
    const isLiked = likedIds.has(n.id);
    const isSaved = savedIds.has(n.id);
    return `
      <article class="pin" data-id="${n.id}">
        <img class="pin-img" src="${n.image_path}" alt="${n.title}" loading="lazy" onerror="this.src='/static/nails/placeholder.svg'">
        <div class="pin-overlay">
          <button class="pin-save ${isSaved ? 'saved' : ''}" data-id="${n.id}">
            ${isSaved ? 'Saved' : 'Save'}
          </button>
          <div class="pin-bottom">
            <span class="pin-title">${n.title}</span>
            <button class="pin-like ${isLiked ? 'liked' : ''}" data-id="${n.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="pin-info">
          <h4>${n.title}</h4>
          <span class="pin-cat">${n.category}</span>
          <span class="pin-likes">${n.likes} likes</span>
        </div>
      </article>
    `;
  }).join("");

  // Wire up events
  grid.querySelectorAll(".pin").forEach((card) => {
    const id = parseInt(card.dataset.id);

    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openDetail(id);
    });
  });

  grid.querySelectorAll(".pin-save").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSave(parseInt(btn.dataset.id), btn);
    });
  });

  grid.querySelectorAll(".pin-like").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLike(parseInt(btn.dataset.id), btn);
    });
  });

  $("#end-msg").style.display = "block";
}

// ─── Filter ───
function filter() {
  currentNails = allNails.filter((n) => {
    const catMatch = !activeCategory || n.category === activeCategory;
    const searchMatch = !searchQuery ||
      n.title.toLowerCase().includes(searchQuery) ||
      n.description.toLowerCase().includes(searchQuery) ||
      n.category.toLowerCase().includes(searchQuery);
    return catMatch && searchMatch;
  });
  render();
}

// ─── Chips ───
$("#chips").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;
  $$(".chip").forEach((c) => c.classList.remove("active"));
  e.target.classList.add("active");
  activeCategory = e.target.dataset.cat;
  filter();
});

// ─── Search ───
let searchDebounce;
$("#search-input").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = e.target.value.toLowerCase().trim();
    filter();
  }, 250);
});

// ─── Like ───
async function toggleLike(id, btnEl) {
  const isLiking = !likedIds.has(id);
  try {
    const res = await fetch("/api/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nail_id: id, session_id: sessionId }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    const nail = currentNails.find((n) => n.id === id);
    if (nail) nail.likes = data.likes;

    if (isLiking) likedIds.add(id);
    else likedIds.delete(id);
    localStorage.setItem("liked-nails", JSON.stringify([...likedIds]));

    if (btnEl) {
      btnEl.classList.toggle("liked", isLiking);
      btnEl.querySelector("svg").setAttribute("fill", isLiking ? "currentColor" : "none");
    }

    // Update count in info
    const card = $(`.pin[data-id="${id}"]`);
    if (card) {
      card.querySelector(".pin-likes").textContent = `${data.likes} likes`;
    }
  } catch {
    toast("Like failed. Try again.");
  }
}

// ─── Save (to board) ───
function toggleSave(id, btnEl) {
  const isSaving = !savedIds.has(id);
  if (isSaving) savedIds.add(id);
  else savedIds.delete(id);
  localStorage.setItem("saved-nails", JSON.stringify([...savedIds]));

  btnEl.classList.toggle("saved", isSaving);
  btnEl.textContent = isSaving ? "Saved" : "Save";
  toast(isSaving ? "Saved to your collection" : "Removed from collection");
}

// ─── Upload Modal ───
const uploadModal = $("#upload-modal");
const detailModal = $("#detail-modal");

$("#btn-upload").addEventListener("click", () => uploadModal.classList.add("show"));
$("#modal-close").addEventListener("click", () => closeUpload());
uploadModal.querySelector(".modal-backdrop").addEventListener("click", () => closeUpload());

function closeUpload() {
  uploadModal.classList.remove("show");
  uploadFile = null;
  $("#upload-zone").innerHTML = `
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7L12 3 9 9"/><path d="M12 3v12"/>
    </svg>
    <p>Drop a photo or click to browse</p>
  `;
  $("#upload-title").value = "";
  $("#btn-submit").disabled = true;
}

let uploadFile = null;
const uploadZone = $("#upload-zone");

uploadZone.addEventListener("click", () => $("#file-upload").click());
uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleUploadFile(e.dataTransfer.files[0]);
});

$("#file-upload").addEventListener("change", (e) => {
  if (e.target.files.length) handleUploadFile(e.target.files[0]);
});

function handleUploadFile(file) {
  if (!file.type.startsWith("image/")) { toast("Please upload an image"); return; }
  uploadFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    uploadZone.innerHTML = `<img src="${e.target.result}" style="max-height:120px;border-radius:8px;">`;
    $("#btn-submit").disabled = false;
  };
  reader.readAsDataURL(file);
}

$("#btn-submit").addEventListener("click", async () => {
  if (!uploadFile) return;

  const formData = new FormData();
  formData.append("image", uploadFile);
  formData.append("title", $("#upload-title").value || "Untitled");
  formData.append("category", $("#upload-category").value);

  $("#btn-submit").disabled = true;
  $("#btn-submit").textContent = "Posting...";

  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error();
    const nail = await res.json();

    allNails.unshift(nail);
    closeUpload();
    $("#btn-submit").textContent = "Post";
    filter();
    toast("Posted! 🎉");
  } catch {
    $("#btn-submit").disabled = false;
    $("#btn-submit").textContent = "Post";
    toast("Upload failed. Try again.");
  }
});

// ─── Detail Modal ───
let currentDetailId = null;

function openDetail(id) {
  const nail = allNails.find((n) => n.id === id);
  if (!nail) return;
  currentDetailId = id;

  $("#detail-img-wrap").innerHTML = `<img src="${nail.image_path}" alt="${nail.title}">`;
  $("#detail-title").textContent = nail.title;
  $("#detail-cat").textContent = nail.category;
  $("#detail-desc").textContent = nail.description || "";
  $("#detail-likes").textContent = nail.likes;

  const likeBtn = $("#btn-like");
  likeBtn.classList.toggle("liked", likedIds.has(id));
  likeBtn.querySelector("svg").setAttribute("fill", likedIds.has(id) ? "currentColor" : "none");

  $("#btn-save").textContent = savedIds.has(id) ? "Saved" : "Save";

  detailModal.classList.add("show");
}

$("#detail-close").addEventListener("click", () => detailModal.classList.remove("show"));
detailModal.querySelector(".modal-backdrop").addEventListener("click", () => detailModal.classList.remove("show"));

$("#btn-like").addEventListener("click", () => {
  toggleLike(currentDetailId);
  // Update detail modal UI
  const nail = currentNails.find((n) => n.id === currentDetailId);
  if (nail) $("#detail-likes").textContent = nail.likes;
  $("#btn-like").classList.toggle("liked", likedIds.has(currentDetailId));
  $("#btn-like svg").setAttribute("fill", likedIds.has(currentDetailId) ? "currentColor" : "none");
});

$("#btn-save").addEventListener("click", () => {
  const isSaved = savedIds.has(currentDetailId);
  if (isSaved) savedIds.delete(currentDetailId);
  else savedIds.add(currentDetailId);
  localStorage.setItem("saved-nails", JSON.stringify([...savedIds]));
  $("#btn-save").textContent = isSaved ? "Save" : "Saved";
  toast(isSaved ? "Removed from collection" : "Saved to your collection");
});

// ─── Toast ───
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

// ─── Init ───
loadNails();
