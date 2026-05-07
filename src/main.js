import "./viewer.js";

const viewer = document.getElementById("viewer");
if (!viewer) throw new Error("No #viewer element found");

// ── Scroll hints ────────────────────────────────────────────
const scrollPane = document.querySelector(".scroll-pane");
const main = document.querySelector(".notebook-main");
const snapTargets = [
  ...document.querySelectorAll(".chapter-title-card, .notebook-section"),
];

const prevBtn = document.createElement("button");
prevBtn.className = "scroll-hint scroll-hint--prev";
prevBtn.setAttribute("aria-label", "Previous section");

const nextBtn = document.createElement("button");
nextBtn.className = "scroll-hint scroll-hint--next";
nextBtn.setAttribute("aria-label", "Next section");

main.appendChild(prevBtn);
main.appendChild(nextBtn);

function currentIndex() {
  const mid = scrollPane.scrollTop + scrollPane.clientHeight / 2;
  let best = 0;
  let bestDist = Infinity;
  snapTargets.forEach((el, i) => {
    const dist = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

function scrollToIndex(i) {
  const el = snapTargets[i];
  if (!el) return;
  scrollPane.scrollTo({ top: el.offsetTop, behavior: "smooth" });
}

function updateHints() {
  const i = currentIndex();
  prevBtn.hidden = i === 0;
  nextBtn.hidden = i === snapTargets.length - 1;
  prevBtn.onclick = () => scrollToIndex(i - 1);
  nextBtn.onclick = () => scrollToIndex(i + 1);
}

scrollPane.addEventListener("scroll", updateHints, { passive: true });
updateHints();
