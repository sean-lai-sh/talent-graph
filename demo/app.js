const network = document.querySelector("#network");
const weightsEl = document.querySelector("#weights");
const signalsEl = document.querySelector("#signals");
const eventsEl = document.querySelector("#events");
const detailEl = document.querySelector("#detail");
const clockEl = document.querySelector("#clock");
const clockMetaEl = document.querySelector("#clock-meta");
const captionEl = document.querySelector("#caption");
const scrub = document.querySelector("#scrub");
const playBtn = document.querySelector("#btn-play");
const statusEl = document.querySelector("#transport-status");
const specLabel = document.querySelector("#spec-label");

const state = {
  data: null,
  index: 0,
  view: "focus",
  selected: null,
  playing: false,
  lastTick: 0,
  holdUntil: 0,
  layout: null,
};

const lerp = (a, b, t) => a + (b - a) * t;

function reliabilityColor(p) {
  if (p >= 0.97) return "#7d857c";
  const t = Math.min(1, Math.max(0, (0.95 - p) / 0.35));
  const good = [134, 179, 146];
  const poor = [197, 109, 78];
  const c = good.map((g, i) => Math.round(lerp(g, poor[i], t)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function nameOf(id) {
  return state.data.people.find((p) => p.id === id)?.name ?? id;
}

function frame() {
  return state.data.frames[state.index];
}

function judgeMap(fr) {
  return new Map(fr.judges.map((j) => [j.id, j]));
}

function signalMap(fr) {
  return new Map(fr.signals.map((s) => [s.id, s]));
}

function captionFor(fr, first) {
  if (fr.evaluatedReferrals === 0) {
    return "No referral has cleared the 180-day window yet. Every judge is still weight 1, so the Referral Signal is exactly the V0 number. The graph refuses to pretend it already knows who is good at this.";
  }
  if (fr.judgesWithEvidence <= 3) {
    return "The first predictions just became eligible. Shrinkage holds those weights near 1 — one scored call is not an oracle. Watch the pale edges: they have not been tested.";
  }
  if (fr.t < "2026-10-01") {
    return "Weights are diverging. Judges whose referrals later matched residual outcomes keep authority; those who over-called or under-called fade. The herd is not the teacher. Time is.";
  }
  if (first) {
    return "By year-end the same 50 referrals produce a different Referral Signal, because the people who wrote them no longer all count as 1. Bram moves more than Alice. Cleo still has almost no referral evidence — calibration cannot invent a recommendation that was never written.";
  }
  return "Later outcomes keep arriving. Each newly eligible referral updates only that judge, in chronological order, with an exponentially weighted error. Nobody is scored against anybody else’s taste.";
}

function computeLayout(view) {
  const { people, edges, personas } = state.data;
  const personaSet = new Set(personas);
  let judges;
  let candidates;
  if (view === "focus") {
    candidates = people.filter((p) => personaSet.has(p.id));
    const wanted = new Set(candidates.map((p) => p.id));
    const judgeIds = new Set(edges.filter((e) => wanted.has(e.candidateId)).map((e) => e.judgeId));
    judges = people.filter((p) => judgeIds.has(p.id));
  } else {
    judges = people.filter((p) => p.judged);
    candidates = people.filter((p) => p.referred);
  }

  const height = view === "focus" ? 640 : Math.max(640, Math.max(judges.length, candidates.length) * 28 + 80);
  const place = (list, x) => {
    const top = 48;
    const bottom = height - 24;
    const span = Math.max(1, list.length - 1);
    return list.map((p, i) => ({
      ...p,
      x,
      y: list.length === 1 ? (top + bottom) / 2 : top + ((bottom - top) * i) / span,
    }));
  };

  return {
    height,
    judges: place(judges, 150),
    candidates: place(candidates, 770),
    edges: edges.filter((e) => {
      const left = judges.some((j) => j.id === e.judgeId);
      const right = candidates.some((c) => c.id === e.candidateId);
      return left && right;
    }),
  };
}

function pathFor(a, b) {
  const c1 = a.x + 150;
  const c2 = b.x - 150;
  return `M ${a.x} ${a.y} C ${c1} ${a.y}, ${c2} ${b.y}, ${b.x} ${b.y}`;
}

function renderNetwork() {
  const fr = frame();
  const layout = state.layout;
  const judges = judgeMap(fr);
  const signals = signalMap(fr);
  const hot = new Set(fr.newlyScored.map((e) => e.referralId));
  const selected = state.selected;

  network.setAttribute("viewBox", `0 0 920 ${layout.height}`);
  const related = new Set();
  if (selected) {
    related.add(selected);
    for (const e of layout.edges) {
      if (e.judgeId === selected || e.candidateId === selected) {
        related.add(e.judgeId);
        related.add(e.candidateId);
      }
    }
  }

  const edgeMarkup = layout.edges
    .map((e) => {
      const judge = layout.judges.find((j) => j.id === e.judgeId);
      const cand = layout.candidates.find((c) => c.id === e.candidateId);
      if (!judge || !cand) return "";
      const rel = judges.get(e.judgeId)?.reliability ?? 1;
      const dim = selected && !related.has(e.judgeId) && !related.has(e.candidateId);
      const cls = ["edge", hot.has(e.id) ? "is-hot" : "", dim ? "is-dim" : ""].filter(Boolean).join(" ");
      return `<path class="${cls}" data-edge="${e.id}" d="${pathFor(judge, cand)}" stroke="${reliabilityColor(rel)}" stroke-width="${1 + e.strength * 3.2}" stroke-opacity="${0.18 + rel * 0.55}" />`;
    })
    .join("");

  const judgeNodes = layout.judges
    .map((p) => {
      const rel = judges.get(p.id)?.reliability ?? 1;
      const n = judges.get(p.id)?.evaluatedCount ?? 0;
      const dim = selected && !related.has(p.id);
      const sel = selected === p.id ? "is-selected" : "";
      return `<g class="node ${dim ? "is-dim" : ""} ${sel}" data-id="${p.id}" transform="translate(${p.x},${p.y})">
        <circle class="halo" r="16" fill="#171b17" stroke="#2c322c" />
        <circle r="11" fill="${reliabilityColor(rel)}" />
        <text class="node-label" x="-22" y="4" text-anchor="end">${p.name}</text>
        <text class="node-sub" x="-22" y="16" text-anchor="end">${rel.toFixed(2)} · ${n}</text>
        <circle class="hit" r="18" data-id="${p.id}" />
      </g>`;
    })
    .join("");

  const candNodes = layout.candidates
    .map((p) => {
      const sig = signals.get(p.id);
      const dim = selected && !related.has(p.id);
      const sel = selected === p.id ? "is-selected" : "";
      const label = sig ? `${sig.v0Display}→${sig.v2Display}` : "";
      return `<g class="node ${dim ? "is-dim" : ""} ${sel}" data-id="${p.id}" transform="translate(${p.x},${p.y})">
        <rect class="halo" x="-14" y="-14" width="28" height="28" rx="3" fill="#171b17" stroke="#2c322c" />
        <rect x="-9" y="-9" width="18" height="18" rx="2" fill="${p.isPersona ? "#c9b48a" : "#6f766e"}" />
        <text class="node-label" x="22" y="4">${p.name}</text>
        <text class="node-sub" x="22" y="16">${label}</text>
        <circle class="hit" r="18" data-id="${p.id}" />
      </g>`;
    })
    .join("");

  network.innerHTML = `
    <text class="col-label" x="150" y="22" text-anchor="middle">Judges</text>
    <text class="col-label" x="770" y="22" text-anchor="middle">Named people</text>
    ${edgeMarkup}${judgeNodes}${candNodes}
  `;
}

function renderWeights() {
  const fr = frame();
  const rows = fr.judges
    .filter((j) => state.data.people.find((p) => p.id === j.id)?.judged)
    .sort((a, b) => b.reliability - a.reliability || a.id.localeCompare(b.id))
    .slice(0, state.view === "focus" ? 12 : 20);
  weightsEl.innerHTML = rows
    .map((j) => {
      const color = reliabilityColor(j.reliability);
      return `<li class="weight-row">
        <div>
          <div class="name">${nameOf(j.id)}</div>
          <div class="bar"><i style="width:${Math.round(j.reliability * 100)}%;background:${color}"></i></div>
        </div>
        <div class="num">${j.reliability.toFixed(2)}</div>
      </li>`;
    })
    .join("");
}

function renderSignals() {
  const fr = frame();
  const ids = state.data.personas;
  signalsEl.innerHTML = ids
    .map((id) => {
      const s = fr.signals.find((row) => row.id === id);
      if (!s) return "";
      const delta = s.v2Display - s.v0Display;
      const cls = delta < 0 ? "down" : delta > 0 ? "up" : "";
      const sign = delta > 0 ? "+" : "";
      return `<li class="signal-row">
        <div>
          <div class="name">${nameOf(id)}</div>
          <div class="bar"><i style="width:${s.v2Display}%;background:${delta < 0 ? "#c56d4e" : "#86b392"}"></i></div>
        </div>
        <div class="num">${s.v0Display} → ${s.v2Display} <span class="delta ${cls}">${sign}${delta}</span></div>
      </li>`;
    })
    .join("");
}

function renderEvents() {
  const recent = [];
  for (let i = 0; i <= state.index; i++) {
    recent.push(...state.data.frames[i].newlyScored);
  }
  const last = recent.slice(-6).reverse();
  eventsEl.innerHTML = last
    .map((e) => {
      const miss = Math.abs(e.signedError);
      return `<li class="event-row">
        <div>
          <div class="who">${nameOf(e.judgeId)} → ${nameOf(e.candidateId)}</div>
          <div class="meta">predicted ${e.prediction.toFixed(2)} · truth ${e.truth.toFixed(2)} · error ${e.error.toFixed(3)}</div>
        </div>
        <div class="num">${miss >= 0.35 ? "miss" : miss >= 0.15 ? "off" : "close"}</div>
      </li>`;
    })
    .join("");
}

function renderDetail() {
  const id = state.selected;
  if (!id) {
    detailEl.innerHTML = `<p class="empty">Click a judge or a candidate in the network.</p>`;
    return;
  }
  const fr = frame();
  const person = state.data.people.find((p) => p.id === id);
  const judge = judgeMap(fr).get(id);
  const signal = signalMap(fr).get(id);
  const outgoing = state.data.edges.filter((e) => e.judgeId === id);
  const incoming = state.data.edges.filter((e) => e.candidateId === id);
  const scored = [];
  for (let i = 0; i <= state.index; i++) {
    for (const ev of state.data.frames[i].newlyScored) {
      if (ev.judgeId === id || ev.candidateId === id) scored.push(ev);
    }
  }
  const bits = [`<p><strong>${person?.name ?? id}</strong></p>`];
  if (judge && outgoing.length) {
    bits.push(
      `<p>Reliability p̂ ${judge.reliability.toFixed(2)} after ${judge.evaluatedCount} scored referral${judge.evaluatedCount === 1 ? "" : "s"}. Bias ${judge.bias >= 0 ? "+" : ""}${judge.bias.toFixed(2)} (estimated, not applied in 2.0.0).</p>`,
    );
  }
  if (signal && incoming.length) {
    bits.push(
      `<p>Referral Signal ${signal.v0Display} with every judge at 1, ${signal.v2Display} after calibration (${signal.v2Display - signal.v0Display}).</p>`,
    );
  }
  if (scored.length) {
    bits.push(
      `<p class="hint">${scored
        .slice(-4)
        .map((e) => `${nameOf(e.judgeId)} predicted ${e.prediction.toFixed(2)} vs ${e.truth.toFixed(2)}`)
        .join(" · ")}</p>`,
    );
  } else if (outgoing.length) {
    bits.push(`<p class="hint">This judge has written ${outgoing.length} referral${outgoing.length === 1 ? "" : "s"}. None are eligible yet at this T.</p>`);
  }
  detailEl.innerHTML = bits.join("");
}

function render() {
  const fr = frame();
  const last = state.index === state.data.frames.length - 1;
  clockEl.textContent = fr.t;
  clockMetaEl.textContent =
    fr.evaluatedReferrals === 0
      ? "Observation window still closed."
      : `${fr.evaluatedReferrals} referrals scored · ${fr.judgesWithEvidence} judges with evidence`;
  captionEl.textContent = captionFor(fr, last);
  statusEl.textContent = `Day ${fr.day} · ${fr.evaluatedReferrals} referrals scored`;
  scrub.value = String(state.index);
  renderNetwork();
  renderWeights();
  renderSignals();
  renderEvents();
  renderDetail();
}

function setIndex(next) {
  state.index = Math.min(state.data.frames.length - 1, Math.max(0, next));
  render();
}

function togglePlay() {
  state.playing = !state.playing;
  playBtn.setAttribute("aria-pressed", state.playing ? "true" : "false");
  playBtn.textContent = state.playing ? "Pause" : "Play the year";
  state.lastTick = 0;
  if (state.playing && state.index >= state.data.frames.length - 1) setIndex(0);
  if (state.playing) requestAnimationFrame(tick);
}

function tick(now) {
  if (!state.playing) return;
  const speed = Number(document.querySelector("#speed").value);
  const fr = frame();
  const dwell = (fr.newlyScored.length ? 1400 : 520) / speed;
  if (!state.lastTick) state.lastTick = now;
  if (now - state.lastTick >= dwell) {
    if (state.index >= state.data.frames.length - 1) {
      state.playing = false;
      playBtn.setAttribute("aria-pressed", "false");
      playBtn.textContent = "Play the year";
      return;
    }
    setIndex(state.index + 1);
    state.lastTick = now;
  }
  requestAnimationFrame(tick);
}

function bind() {
  playBtn.addEventListener("click", togglePlay);
  document.querySelector("#btn-reset").addEventListener("click", () => {
    state.playing = false;
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.textContent = "Play the year";
    setIndex(0);
  });
  document.querySelector("#btn-step").addEventListener("click", () => setIndex(state.index + 1));
  document.querySelector("#btn-step-back").addEventListener("click", () => setIndex(state.index - 1));
  scrub.addEventListener("input", () => setIndex(Number(scrub.value)));
  for (const btn of document.querySelectorAll(".toggle")) {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      for (const other of document.querySelectorAll(".toggle")) {
        other.classList.toggle("is-on", other === btn);
        other.setAttribute("aria-pressed", other === btn ? "true" : "false");
      }
      state.layout = computeLayout(state.view);
      render();
    });
  }
  network.addEventListener("click", (event) => {
    const hit = event.target.closest("[data-id]");
    if (!hit) {
      state.selected = null;
      render();
      return;
    }
    state.selected = hit.getAttribute("data-id");
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    } else if (event.code === "ArrowRight") setIndex(state.index + 1);
    else if (event.code === "ArrowLeft") setIndex(state.index - 1);
  });
}

async function main() {
  const res = await fetch("/api/timeline");
  if (!res.ok) {
    captionEl.textContent = "Could not load the timeline from the algorithm core.";
    return;
  }
  state.data = await res.json();
  scrub.max = String(state.data.frames.length - 1);
  specLabel.textContent = `referral_signal@${state.data.referralSpecVersion} · judge_reliability@${state.data.specVersion}`;
  state.layout = computeLayout(state.view);
  bind();
  render();
}

main();
