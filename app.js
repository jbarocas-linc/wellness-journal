const {
  createDefaultButtons,
  createEntry,
  createId,
  downloadJson,
  exportState,
  importState,
  loadState,
  saveState,
} = window.StorageUtils;
const {
  analyzePatternsWithClaude,
  parseJournalEntryWithClaude,
} = window.ClaudeApi;
const {
  MOOD_WORD_GRID,
  answerPatternQuestionLocally,
  buildChartData,
  buildTimelineDays,
  computePatternInsights,
  findNearestMoodWord,
  getAutoAddCandidates,
  getDayKey,
  syncButtonsWithUsage,
  titleCase,
} = window.Patterns;

const SCREEN_TITLES = ["Text Input", "Activity Buttons", "Mood Meter"];
const CHART_RANGES = [7, 14, 30, 60, 90];
const ANSWER_CACHE_TTL = 24 * 60 * 60 * 1000;

const ACTIVITY_ALIASES = [
  { name: "coffee", aliases: ["coffee", "coffees", "espresso", "latte", "cold brew"] },
  { name: "dog walk", aliases: ["dog walk", "walked the dog", "walk dog", "walked dog"] },
  { name: "adderall", aliases: ["adderall", "meds", "medication", "took my meds", "took meds"] },
  { name: "cannabis", aliases: ["cannabis", "weed", "smoked", "edible", "used weed"] },
  { name: "alcohol", aliases: ["alcohol", "drank", "beer", "wine", "cocktail"] },
  { name: "exercise", aliases: ["exercise", "worked out", "workout", "ran", "run", "lifted", "yoga"] },
  { name: "laundry", aliases: ["laundry", "did laundry", "wash clothes"] },
  { name: "made dinner", aliases: ["made dinner", "cooked", "cook dinner"] },
  { name: "tv before bed", aliases: ["tv before bed", "watched tv before bed", "television before bed"] },
  { name: "reading before bed", aliases: ["reading before bed", "read before bed"] },
];

const EXTRA_FEELINGS = [
  "patient",
  "irritable",
  "grounded",
  "tired",
  "rested",
  "overwhelmed",
  "connected",
  "present",
  "calm",
  "stuck",
  "foggy",
  "clear",
  "peaceful",
  "tense",
  "restless",
];

const FEELING_WORDS = new Set([
  ...MOOD_WORD_GRID.flat().map((word) => word.toLowerCase()),
  ...EXTRA_FEELINGS,
]);

const state = loadState();
const ui = {
  activeScreen: 0,
  activeTab: "timeline",
  summaryOpen: false,
  timelineDays: 7,
  activityDraft: {},
  moodMode: "word",
  selectedMoodWord: null,
  precisionPoint: null,
  questionResponse: null,
  chartRange: 30,
  chartSelections: {},
  pinch: null,
  gestureStart: null,
};

const dom = {};

function normalizeName(value = "") {
  return String(value).trim().toLowerCase();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function haptic(ms = 12) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 2200);
}

function safeNumberMatch(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : null;
}

function inferActivityCount(lowerText, aliases) {
  let count = 0;
  let explicit = false;

  aliases.forEach((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const quantityRegex = new RegExp(`(\\d+)\\s+${escaped}`, "gi");
    let match;
    while ((match = quantityRegex.exec(lowerText)) !== null) {
      count += Number(match[1]);
      explicit = true;
    }
  });

  if (explicit) return count;

  aliases.forEach((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const presenceRegex = new RegExp(`\\b${escaped}\\b`, "gi");
    let matchCount = 0;
    while (presenceRegex.exec(lowerText) !== null) {
      matchCount += 1;
    }
    count += matchCount;
  });

  return count;
}

function parseFeelings(text) {
  const lowerText = text.toLowerCase();
  const feelings = new Set();

  const feelingPhrases = lowerText.match(/(?:feeling|felt|am|i'm|ive been|i’ve been)\s+([^.,;!?]+)/g) || [];
  feelingPhrases.forEach((phrase) => {
    phrase
      .replace(/^(?:feeling|felt|am|i'm|ive been|i’ve been)\s+/g, "")
      .split(/,| and /)
      .map((part) => part.trim())
      .forEach((part) => {
        const candidate = part.split(" ").find((word) => FEELING_WORDS.has(word));
        if (candidate) feelings.add(candidate);
      });
  });

  FEELING_WORDS.forEach((word) => {
    if (lowerText.includes(word)) feelings.add(word);
  });

  return [...feelings];
}

function localParseJournalEntry(text) {
  const lowerText = text.toLowerCase();
  const activities = {};

  ACTIVITY_ALIASES.forEach((activity) => {
    const count = inferActivityCount(lowerText, activity.aliases);
    if (count > 0) {
      activities[activity.name] = count;
    }
  });

  return {
    activities,
    mood: {
      feelings: parseFeelings(text),
      energy_level: safeNumberMatch(lowerText, /energy(?:\s+level)?\s*(\d{1,2})/i),
      pleasantness: safeNumberMatch(lowerText, /pleasant(?:ness)?\s*(\d{1,2})/i),
    },
    observations: text.trim(),
  };
}

async function parseTextWithFallback(text) {
  const apiKey = state.settings.api_key;

  if (!apiKey) {
    return { parsed: localParseJournalEntry(text), source: "local" };
  }

  try {
    const parsed = await parseJournalEntryWithClaude(text, apiKey);
    return { parsed, source: "claude" };
  } catch (error) {
    console.error(error);
    return { parsed: localParseJournalEntry(text), source: "local", error };
  }
}

function mergeActivities(...activityMaps) {
  return activityMaps.reduce((accumulator, current) => {
    Object.entries(current || {}).forEach(([name, count]) => {
      const normalized = normalizeName(name);
      const numericCount = typeof count === "boolean" ? (count ? 1 : 0) : Number(count) || 0;
      accumulator[normalized] = (accumulator[normalized] || 0) + numericCount;
    });
    return accumulator;
  }, {});
}

function getTodayActivityTotals() {
  const todayKey = getDayKey(new Date().toISOString());
  const totals = {};

  state.entries.forEach((entry) => {
    if (getDayKey(entry.timestamp) !== todayKey) return;

    const sourceActivities =
      entry.type === "activity"
        ? entry.data.activities || {}
        : entry.type === "text"
          ? ((entry.data.parsed_data && entry.data.parsed_data.activities) || {})
          : ((entry.data.parsed_text && entry.data.parsed_text.activities) || {});

    Object.entries(sourceActivities).forEach(([name, count]) => {
      const key = normalizeName(name);
      const numericCount = Number(count) || 0;
      totals[key] = (totals[key] || 0) + numericCount;
    });
  });

  return totals;
}

function syncDerivedState() {
  if (!Array.isArray(state.buttons) || !state.buttons.length) {
    state.buttons = createDefaultButtons();
  }

  state.buttons = syncButtonsWithUsage(state.buttons, state.entries);

  const candidates = getAutoAddCandidates(state.entries, state.buttons, state.settings);
  if (candidates.length) {
    const now = new Date().toISOString();
    state.buttons = [
      ...state.buttons,
      ...candidates.map((candidate) => ({
        ...candidate,
        id: createId("button"),
        usage_count: 0,
        date_added: now,
      })),
    ];
    state.buttons = syncButtonsWithUsage(state.buttons, state.entries);
  }

  Object.keys(state.cache.answers || {}).forEach((key) => {
    if (Date.now() - state.cache.answers[key].timestamp > ANSWER_CACHE_TTL) {
      delete state.cache.answers[key];
    }
  });
}

function persist() {
  syncDerivedState();
  saveState(state);
}

function setActiveScreen(index) {
  ui.activeScreen = Math.max(0, Math.min(2, index));
  renderNavigation();
}

function toggleSummary(open) {
  ui.summaryOpen = open;
  dom.summaryPanel.classList.toggle("is-open", open);
  dom.summaryPanel.setAttribute("aria-hidden", String(!open));
  if (open) {
    renderSummary();
  }
}

function openModal(element) {
  element.classList.add("is-open");
  element.setAttribute("aria-hidden", "false");
}

function closeModal(element) {
  element.classList.remove("is-open");
  element.setAttribute("aria-hidden", "true");
}

function renderNavigation() {
  dom.screenTitle.textContent = SCREEN_TITLES[ui.activeScreen];
  dom.screens.forEach((screen, index) => {
    screen.classList.toggle("is-active", index === ui.activeScreen);
  });
  dom.screenDots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === ui.activeScreen);
  });
}

function renderActivityGrid() {
  const todayTotals = getTodayActivityTotals();

  dom.activityGrid.innerHTML = state.buttons
    .map((button) => {
      const persisted = todayTotals[normalizeName(button.name)] || 0;
      const draft = button.type === "single-tap" ? Boolean(ui.activityDraft[button.id]) : ui.activityDraft[button.id] || 0;
      const displayCount = button.type === "multi-tap" ? persisted + draft : persisted > 0 || draft;
      const selected = button.type === "single-tap" ? draft : draft > 0;
      const todayMeta =
        button.type === "single-tap"
          ? displayCount
            ? "Logged today"
            : "Tap to log"
          : `${displayCount} today`;

      return `
        <button
          class="activity-button ${selected ? "is-selected" : ""} ${persisted ? "has-today" : ""}"
          data-button-id="${button.id}"
          type="button"
          aria-label="${escapeHtml(button.name)}"
        >
          <span class="button-name">${escapeHtml(button.name)}</span>
          <span class="button-meta">${escapeHtml(todayMeta)}</span>
        </button>
      `;
    })
    .join("");

  dom.activityGrid.querySelectorAll("[data-button-id]").forEach((buttonElement) => {
    const button = state.buttons.find((item) => item.id === buttonElement.dataset.buttonId);
    attachLongPress(buttonElement, () => adjustActivityDraft(button, 1), () => adjustActivityDraft(button, -1));
  });
}

function adjustActivityDraft(button, delta) {
  if (!button) return;

  if (button.type === "single-tap") {
    ui.activityDraft[button.id] = delta > 0;
  } else {
    const current = ui.activityDraft[button.id] || 0;
    ui.activityDraft[button.id] = Math.max(0, current + delta);
  }

  haptic();
  renderActivityGrid();
}

function getMoodQuadrantClass(rowIndex, columnIndex) {
  const topHalf = rowIndex < 5;
  const rightHalf = columnIndex >= 5;
  if (topHalf && !rightHalf) return "quadrant-red";
  if (topHalf && rightHalf) return "quadrant-yellow";
  if (!topHalf && !rightHalf) return "quadrant-blue";
  return "quadrant-green";
}

function renderMoodGrid() {
  dom.moodModeToggle.checked = ui.moodMode === "precision";
  dom.moodGrid.classList.toggle("is-precision", ui.moodMode === "precision");
  dom.moodPrecisionOverlay.classList.toggle("is-active", ui.moodMode === "precision");
  dom.moodPrecisionOverlay.setAttribute("aria-hidden", String(ui.moodMode !== "precision"));

  dom.moodGrid.innerHTML = MOOD_WORD_GRID.map((row, rowIndex) =>
    row
      .map((word, columnIndex) => {
        const selected = ui.selectedMoodWord && ui.selectedMoodWord.word === word;
        return `
          <button
            class="mood-cell ${getMoodQuadrantClass(rowIndex, columnIndex)} ${selected ? "is-selected" : ""}"
            data-word="${escapeHtml(word)}"
            data-row="${rowIndex}"
            data-column="${columnIndex}"
            type="button"
            role="gridcell"
            aria-label="${escapeHtml(word)}"
          >
            ${escapeHtml(word)}
          </button>
        `;
      })
      .join(""),
  ).join("");

  dom.moodGrid.querySelectorAll("[data-word]").forEach((cell) => {
    cell.addEventListener("click", () => {
      if (ui.moodMode === "precision") return;

      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      ui.selectedMoodWord = {
        word: cell.dataset.word,
        coordinates: {
          x: (column + 0.5) / 10,
          y: 1 - (row + 0.5) / 10,
        },
      };
      ui.precisionPoint = null;
      haptic();
      renderMoodGrid();
    });
  });

  renderPrecisionDot();
}

function renderPrecisionDot() {
  const point = ui.moodMode === "precision"
    ? ui.precisionPoint
    : (ui.selectedMoodWord ? ui.selectedMoodWord.coordinates : null);

  if (!point) {
    dom.moodDot.hidden = true;
    dom.nearestWordLabel.hidden = true;
    return;
  }

  const nearest = findNearestMoodWord({ x: point.x, y: point.y });
  dom.moodDot.hidden = false;
  dom.nearestWordLabel.hidden = false;
  dom.moodDot.style.left = `${point.x * 100}%`;
  dom.moodDot.style.top = `${(1 - point.y) * 100}%`;
  dom.nearestWordLabel.style.left = `${point.x * 100}%`;
  dom.nearestWordLabel.style.top = `${(1 - point.y) * 100}%`;
  dom.nearestWordLabel.textContent = nearest.word;
}

function renderTimeline() {
  const timelineDays = buildTimelineDays(state.entries, ui.timelineDays);

  dom.timelineTab.innerHTML = `
    <div class="timeline-list">
      ${timelineDays
        .map((day) => {
          const activities = day.activities.length
            ? day.activities.map((item) => `${escapeHtml(item.name)} (${item.value})`).join(", ")
            : "No activity entries";
          const moods = day.moods.length
            ? day.moods.map((item) => `${escapeHtml(item.label)} (${escapeHtml(item.time)})`).join(", ")
            : "No mood entries";
          const notes = day.notes.length
            ? day.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
            : "<li>No additional notes.</li>";

          return `
            <article class="timeline-day">
              <h3>${escapeHtml(day.label)}</h3>
              <p class="timeline-meta"><strong>Activities:</strong> ${activities}</p>
              <p class="timeline-meta"><strong>Mood:</strong> ${moods}</p>
              <details>
                <summary>Notes</summary>
                <ul>${notes}</ul>
              </details>
            </article>
          `;
        })
        .join("")}
    </div>
    <button id="load-earlier-button" class="secondary-button" type="button">Load earlier days</button>
  `;

  const loadEarlierButton = dom.timelineTab.querySelector("#load-earlier-button");
  if (loadEarlierButton) {
    loadEarlierButton.addEventListener("click", () => {
      ui.timelineDays += 7;
      renderTimeline();
    });
  }
}

function renderPatterns() {
  const insights = computePatternInsights(state.entries);
  const response = ui.questionResponse
    ? `
      <article class="qa-response">
        <h3>Question response</h3>
        <div class="pattern-list">
          ${ui.questionResponse.map((line) => `<p class="timeline-meta">${escapeHtml(line)}</p>`).join("")}
        </div>
      </article>
    `
    : "";

  dom.patternsTab.innerHTML = `
    ${response}
    <div class="pattern-list">
      ${insights
        .map(
          (insight) => `
            <article class="pattern-card">
              <p>${escapeHtml(insight)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function makePolyline(points, width, height) {
  const usable = points.filter((point) => point.value !== null);
  if (!usable.length) return "";

  const xForIndex = (index) =>
    usable.length === 1 ? width / 2 : (index / (usable.length - 1)) * (width - 28) + 14;
  const yForValue = (value) => height - 18 - (value / 10) * (height - 32);

  return usable.map((point, index) => `${xForIndex(index)},${yForValue(point.value)}`).join(" ");
}

function renderCombinedMoodChart(chartData) {
  const width = 320;
  const height = 180;
  const showEnergy = ui.chartSelections.moodEnergy !== false;
  const showPleasantness = ui.chartSelections.moodPleasantness !== false;
  const energyUsable = chartData.energySeries.filter((point) => point.value !== null);
  const pleasantUsable = chartData.pleasantnessSeries.filter((point) => point.value !== null);
  const energyPoints = makePolyline(chartData.energySeries, width, height);
  const pleasantnessPoints = makePolyline(chartData.pleasantnessSeries, width, height);

  const tooltip = ui.chartSelections.combinedMood
    ? `<p class="chart-tooltip">${escapeHtml(ui.chartSelections.combinedMood)}</p>`
    : `<p class="chart-tooltip">Tap a point for details. Pinch the chart area to change the day range.</p>`;

  return `
    <article class="chart-card">
      <h3>Mood over time</h3>
      <div class="legend-row">
        <button class="legend-toggle ${showEnergy ? "is-active" : ""}" data-toggle-series="moodEnergy" type="button">Energy</button>
        <button class="legend-toggle ${showPleasantness ? "is-active" : ""}" data-toggle-series="moodPleasantness" type="button">Pleasantness</button>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mood over time chart">
        <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.02)"></rect>
        <line x1="14" y1="${height - 18}" x2="${width - 14}" y2="${height - 18}" stroke="rgba(255,255,255,0.12)"></line>
        <line x1="14" y1="14" x2="14" y2="${height - 18}" stroke="rgba(255,255,255,0.12)"></line>
        ${showEnergy && energyPoints ? `<polyline fill="none" stroke="#0a84ff" stroke-width="3" points="${energyPoints}"></polyline>` : ""}
        ${showPleasantness && pleasantnessPoints ? `<polyline fill="none" stroke="#30d158" stroke-width="3" points="${pleasantnessPoints}"></polyline>` : ""}
        ${
          showEnergy
            ? energyUsable
                .map((point, index) => {
                  const x = energyUsable.length === 1 ? width / 2 : (index / (energyUsable.length - 1)) * (width - 28) + 14;
                  const y = height - 18 - (point.value / 10) * (height - 32);
                  return `<circle cx="${x}" cy="${y}" r="5" fill="#0a84ff" data-chart-point="combinedMood" data-point-label="${escapeHtml(point.label)} energy ${point.value.toFixed(1)}/10"></circle>`;
                })
                .join("")
            : ""
        }
        ${
          showPleasantness
            ? pleasantUsable
                .map((point, index) => {
                  const x =
                    pleasantUsable.length === 1 ? width / 2 : (index / (pleasantUsable.length - 1)) * (width - 28) + 14;
                  const y = height - 18 - (point.value / 10) * (height - 32);
                  return `<circle cx="${x}" cy="${y}" r="5" fill="#30d158" data-chart-point="combinedMood" data-point-label="${escapeHtml(point.label)} pleasantness ${point.value.toFixed(1)}/10"></circle>`;
                })
                .join("")
            : ""
        }
      </svg>
      ${tooltip}
    </article>
  `;
}

function renderActivityChart(chartData) {
  const width = 320;
  const height = 180;
  const max = Math.max(...chartData.activitySeries.map((item) => item.value), 1);
  const tooltip = ui.chartSelections.activity
    ? `<p class="chart-tooltip">${escapeHtml(ui.chartSelections.activity)}</p>`
    : `<p class="chart-tooltip">Tap a bar for details.</p>`;

  return `
    <article class="chart-card">
      <h3>Activity frequency</h3>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Activity frequency chart">
        <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.02)"></rect>
        ${chartData.activitySeries
          .map((item, index) => {
            const barWidth = 26;
            const gap = 12;
            const x = 18 + index * (barWidth + gap);
            const barHeight = (item.value / max) * 110;
            const y = 140 - barHeight;
            return `
              <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="#ff9f0a" data-chart-point="activity" data-point-label="${escapeHtml(item.label)} ${item.value}"></rect>
              <text x="${x + barWidth / 2}" y="156" text-anchor="middle" fill="#999999" font-size="10">${escapeHtml(
                item.label.slice(0, 6),
              )}</text>
            `;
          })
          .join("")}
      </svg>
      ${tooltip}
    </article>
  `;
}

function renderScatterChart(chartData) {
  const width = 320;
  const height = 180;
  const tooltip = ui.chartSelections.scatter
    ? `<p class="chart-tooltip">${escapeHtml(ui.chartSelections.scatter)}</p>`
    : `<p class="chart-tooltip">Tap a point for the day and time.</p>`;

  return `
    <article class="chart-card">
      <h3>Mood scatter</h3>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mood scatter chart">
        <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.02)"></rect>
        <line x1="14" y1="${height - 18}" x2="${width - 14}" y2="${height - 18}" stroke="rgba(255,255,255,0.12)"></line>
        <line x1="14" y1="14" x2="14" y2="${height - 18}" stroke="rgba(255,255,255,0.12)"></line>
        ${chartData.scatterSeries
          .map((point) => {
            const x = 14 + point.x * (width - 28);
            const y = 14 + (1 - point.y) * (height - 32);
            return `<circle cx="${x}" cy="${y}" r="5" fill="#ffd60a" data-chart-point="scatter" data-point-label="${escapeHtml(
              `${point.label} on ${point.dayKey} at ${point.time}`,
            )}"></circle>`;
          })
          .join("")}
      </svg>
      ${tooltip}
    </article>
  `;
}

function renderCorrelationChart(chartData) {
  const width = 320;
  const height = 180;
  const max = Math.max(...chartData.correlationSeries.map((item) => item.value || 0), 1);
  const tooltip = ui.chartSelections.correlation
    ? `<p class="chart-tooltip">${escapeHtml(ui.chartSelections.correlation)}</p>`
    : `<p class="chart-tooltip">Tap a bar for the average.</p>`;

  return `
    <article class="chart-card">
      <h3>Correlation bars</h3>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Correlation chart">
        <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.02)"></rect>
        ${chartData.correlationSeries
          .map((item, index) => {
            const barWidth = 56;
            const gap = 14;
            const x = 18 + index * (barWidth + gap);
            const value = item.value || 0;
            const barHeight = (value / max) * 110;
            const y = 140 - barHeight;
            return `
              <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="10" fill="#30d158" data-chart-point="correlation" data-point-label="${escapeHtml(
                `${item.label}: ${value.toFixed(1)}/10`,
              )}"></rect>
              <text x="${x + barWidth / 2}" y="156" text-anchor="middle" fill="#999999" font-size="10">${escapeHtml(
                index === 0 ? "Ex" : index === 1 ? "No Ex" : index === 2 ? "Can +" : "No Can",
              )}</text>
            `;
          })
          .join("")}
      </svg>
      ${tooltip}
    </article>
  `;
}

function renderCharts() {
  const chartData = buildChartData(state.entries, ui.chartRange);

  dom.chartsTab.innerHTML = `
    <div class="legend-row">
      ${CHART_RANGES.map(
        (range) => `
          <button class="legend-toggle ${ui.chartRange === range ? "is-active" : ""}" data-chart-range="${range}" type="button">
            ${range}d
          </button>
        `,
      ).join("")}
    </div>
    <div class="chart-grid">
      ${renderCombinedMoodChart(chartData)}
      ${renderActivityChart(chartData)}
      ${renderScatterChart(chartData)}
      ${renderCorrelationChart(chartData)}
    </div>
  `;

  dom.chartsTab.querySelectorAll("[data-chart-range]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.chartRange = Number(button.dataset.chartRange);
      renderCharts();
    });
  });

  dom.chartsTab.querySelectorAll("[data-toggle-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.toggleSeries;
      ui.chartSelections[key] = ui.chartSelections[key] === false;
      renderCharts();
    });
  });

  dom.chartsTab.querySelectorAll("[data-chart-point]").forEach((element) => {
    element.addEventListener("click", () => {
      ui.chartSelections[element.dataset.chartPoint] = element.dataset.pointLabel;
      renderCharts();
    });
  });
}

function renderSummary() {
  renderTimeline();
  renderPatterns();
  renderCharts();
  dom.summaryTabs.forEach((tab) => {
    const active = tab.dataset.tab === ui.activeTab;
    tab.classList.toggle("is-active", active);
  });
  dom.tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `${ui.activeTab}-tab`);
  });
}

function renderButtonList() {
  dom.buttonList.innerHTML = state.buttons
    .map(
      (button) => `
        <div class="button-row">
          <div>
            <strong>${escapeHtml(button.name)}</strong>
            <div class="row-meta">${button.type} · used ${button.usage_count} times</div>
          </div>
          <button class="secondary-button" data-remove-button="${button.id}" type="button">Remove</button>
        </div>
      `,
    )
    .join("");

  dom.buttonList.querySelectorAll("[data-remove-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const removed = state.buttons.find((item) => item.id === button.dataset.removeButton);
      state.buttons = state.buttons.filter((item) => item.id !== button.dataset.removeButton);
      if (removed) {
        const hidden = new Set(state.settings.hidden_buttons || []);
        hidden.add(normalizeName(removed.name));
        state.settings.hidden_buttons = [...hidden];
      }
      persist();
      renderAll();
    });
  });
}

function renderSettings() {
  dom.settingsApiKeyInput.value = state.settings.api_key || "";
  renderButtonList();
}

function renderSetupModal() {
  dom.apiKeyInput.value = state.settings.api_key || "";
  if (state.settings.setup_complete) {
    closeModal(dom.setupModal);
  } else {
    openModal(dom.setupModal);
  }
}

function renderAll() {
  if (dom.runtimeStatus) {
    dom.runtimeStatus.textContent = "Interactive";
    dom.runtimeStatus.classList.add("is-live");
  }
  renderNavigation();
  renderActivityGrid();
  renderMoodGrid();
  renderSettings();
  if (ui.summaryOpen) {
    renderSummary();
  }
  renderSetupModal();
}

function attachLongPress(element, onTap, onLongPress) {
  let timer = null;
  let longPressed = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  element.addEventListener("contextmenu", (event) => event.preventDefault());
  element.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    longPressed = false;
    timer = setTimeout(() => {
      longPressed = true;
      onLongPress();
    }, 420);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
    element.addEventListener(eventName, () => {
      clear();
      if (!longPressed && eventName === "pointerup") onTap();
      longPressed = false;
    });
  });
}

async function submitTextEntry() {
  const rawInput = dom.textEntryInput.value.trim();
  if (!rawInput) {
    showToast("Add a note before submitting.");
    return;
  }

  const result = await parseTextWithFallback(rawInput);
  state.entries.push(
    createEntry({
      type: "text",
      rawInput,
      data: {
        parsed_data: result.parsed,
      },
    }),
  );
  dom.textEntryInput.value = "";
  persist();
  renderAll();
  showToast(result.source === "claude" ? "Entry saved." : "Entry saved with local parsing.");
}

async function submitActivityEntry() {
  const context = dom.activityContextInput.value.trim();
  const draftedActivities = {};

  state.buttons.forEach((button) => {
    const value = ui.activityDraft[button.id];
    if (!value) return;
    draftedActivities[normalizeName(button.name)] = button.type === "single-tap" ? 1 : value;
  });

  if (!Object.keys(draftedActivities).length && !context) {
    showToast("Select a button or add context.");
    return;
  }

  let parsedContext = null;
  let source = "local";
  if (context) {
    const result = await parseTextWithFallback(context);
    parsedContext = result.parsed;
    source = result.source;
  }

  state.entries.push(
    createEntry({
      type: "activity",
      rawInput: context,
      data: {
        activities: mergeActivities(
          draftedActivities,
          parsedContext ? parsedContext.activities : null,
        ),
        context,
        parsed_context: parsedContext,
      },
    }),
  );

  ui.activityDraft = {};
  dom.activityContextInput.value = "";
  persist();
  renderAll();
  showToast(source === "claude" ? "Activity entry saved." : "Activity entry saved.");
}

async function submitMoodEntry() {
  const textInput = dom.moodContextInput.value.trim();
  const point = ui.moodMode === "precision"
    ? ui.precisionPoint
    : (ui.selectedMoodWord ? ui.selectedMoodWord.coordinates : null);
  const word =
    ui.moodMode === "word"
      ? ((ui.selectedMoodWord && ui.selectedMoodWord.word) || null)
      : point
        ? findNearestMoodWord(point).word
        : null;

  if (!point && !textInput) {
    showToast("Select a mood point or add context.");
    return;
  }

  let parsedText = null;
  let source = "local";
  if (textInput) {
    const result = await parseTextWithFallback(textInput);
    parsedText = result.parsed;
    source = result.source;
  }

  state.entries.push(
    createEntry({
      type: "mood",
      rawInput: textInput,
      data: {
        mood_data: point
          ? {
              method: ui.moodMode === "precision" ? "precision" : "word_select",
              word,
              coordinates: point,
              pleasantness: point.x,
              energy: point.y,
            }
          : null,
        text_input: textInput,
        parsed_text: parsedText,
      },
    }),
  );

  dom.moodContextInput.value = "";
  ui.selectedMoodWord = null;
  ui.precisionPoint = null;
  persist();
  renderAll();
  showToast(source === "claude" ? "Mood entry saved." : "Mood entry saved.");
}

async function answerQuestion() {
  const question = dom.questionInput.value.trim();
  if (!question) {
    showToast("Add a question first.");
    return;
  }

  const lastEntry = state.entries[state.entries.length - 1];
  const signature = `${question.toLowerCase()}::${state.entries.length}::${(lastEntry && lastEntry.timestamp) || "none"}`;
  const cached = state.cache.answers ? state.cache.answers[signature] : null;
  if (cached && Date.now() - cached.timestamp < ANSWER_CACHE_TTL) {
    ui.questionResponse = cached.lines;
    ui.activeTab = "patterns";
    renderSummary();
    return;
  }

  let lines = null;

  if (state.settings.api_key) {
    try {
      const response = await analyzePatternsWithClaude(state.entries.slice(-120), question, state.settings.api_key);
      lines = response
        .split("\n")
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
    } catch (error) {
      console.error(error);
    }
  }

  if (!lines || !lines.length) {
    lines = answerPatternQuestionLocally(state.entries, question);
  }

  ui.questionResponse = lines;
  state.cache.answers[signature] = { lines, timestamp: Date.now() };
  persist();
  ui.activeTab = "patterns";
  renderSummary();
}

function startVoiceInput(target) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showToast("Voice input is not supported in this browser.");
    return;
  }

  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    const transcript =
      event &&
      event.results &&
      event.results[0] &&
      event.results[0][0] &&
      event.results[0][0].transcript
        ? event.results[0][0].transcript
        : "";
    target.value = transcript;
  };

  recognition.onerror = () => {
    showToast("Voice input did not complete.");
  };

  recognition.start();
}

function handlePrecisionInteraction(clientX, clientY) {
  if (ui.moodMode !== "precision") return;
  const rect = dom.moodPrecisionOverlay.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
  ui.precisionPoint = { x, y };
  ui.selectedMoodWord = null;
  renderPrecisionDot();
}

function saveApiKey(value) {
  state.settings.api_key = value.trim();
  state.settings.setup_complete = true;
  persist();
  renderAll();
}

function addCustomButton() {
  const name = dom.customButtonName.value.trim();
  const type = dom.customButtonType.value;
  if (!name) {
    showToast("Add a button name first.");
    return;
  }

  if (state.buttons.some((button) => normalizeName(button.name) === normalizeName(name))) {
    showToast("That button already exists.");
    return;
  }

  state.buttons.push({
    id: createId("button"),
    name: titleCase(name),
    type,
    usage_count: 0,
    auto_added: false,
    date_added: new Date().toISOString(),
  });
  state.settings.hidden_buttons = (state.settings.hidden_buttons || []).filter(
    (hiddenName) => hiddenName !== normalizeName(name),
  );
  dom.customButtonName.value = "";
  persist();
  renderAll();
}

function exportData() {
  const filename = `wellness-journal-${new Date().toISOString().split("T")[0]}.json`;
  downloadJson(filename, exportState(state));
}

async function importData(file) {
  if (!file) return;
  const text = await file.text();
  const imported = importState(text, state.settings.api_key);
  state.entries = imported.entries;
  state.buttons = imported.buttons;
  state.settings = { ...imported.settings, api_key: state.settings.api_key || imported.settings.api_key };
  state.cache = imported.cache;
  persist();
  renderAll();
  showToast("Data imported.");
}

function bindEvents() {
  dom.screenDots.forEach((dot, index) => {
    dot.addEventListener("click", () => setActiveScreen(index));
  });

  dom.openSummaryButton.addEventListener("click", () => toggleSummary(true));
  dom.closeSummaryButton.addEventListener("click", () => toggleSummary(false));
  dom.openSettingsButton.addEventListener("click", () => {
    renderSettings();
    openModal(dom.settingsModal);
  });
  dom.closeSettingsButton.addEventListener("click", () => closeModal(dom.settingsModal));

  dom.textSubmitButton.addEventListener("click", submitTextEntry);
  dom.activitySubmitButton.addEventListener("click", submitActivityEntry);
  dom.moodSubmitButton.addEventListener("click", submitMoodEntry);
  dom.questionSubmitButton.addEventListener("click", answerQuestion);

  dom.textMicButton.addEventListener("click", () => startVoiceInput(dom.textEntryInput));
  dom.moodMicButton.addEventListener("click", () => startVoiceInput(dom.moodContextInput));
  dom.questionMicButton.addEventListener("click", () => startVoiceInput(dom.questionInput));

  dom.moodModeToggle.addEventListener("change", () => {
    ui.moodMode = dom.moodModeToggle.checked ? "precision" : "word";
    renderMoodGrid();
  });

  dom.moodPrecisionOverlay.addEventListener("pointerdown", (event) => handlePrecisionInteraction(event.clientX, event.clientY));
  dom.moodPrecisionOverlay.addEventListener("pointermove", (event) => {
    if (event.buttons) handlePrecisionInteraction(event.clientX, event.clientY);
  });

  dom.summaryTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      ui.activeTab = tab.dataset.tab;
      renderSummary();
    });
  });

  dom.saveApiKeyButton.addEventListener("click", () => saveApiKey(dom.apiKeyInput.value));
  dom.skipApiKeyButton.addEventListener("click", () => {
    state.settings.setup_complete = true;
    persist();
    renderAll();
  });
  dom.updateApiKeyButton.addEventListener("click", () => {
    saveApiKey(dom.settingsApiKeyInput.value);
    closeModal(dom.settingsModal);
    showToast("API key updated.");
  });

  dom.addCustomButtonButton.addEventListener("click", addCustomButton);
  dom.exportDataButton.addEventListener("click", exportData);
  dom.importDataButton.addEventListener("click", () => dom.importDataInput.click());
  dom.importDataInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    await importData(file);
    event.target.value = "";
  });

  document.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2 && ui.activeTab === "charts" && ui.summaryOpen) {
      const [a, b] = event.touches;
      ui.pinch = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), applied: false };
      return;
    }

    if (event.touches.length !== 1) return;
    const target = event.target;
    if (target.closest("input, textarea, select, .modal-card")) return;
    ui.gestureStart = {
      x: event.touches[0].screenX,
      y: event.touches[0].screenY,
    };
  });

  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 2 && ui.pinch && ui.activeTab === "charts" && ui.summaryOpen) {
        const [a, b] = event.touches;
        const nextDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const diff = nextDistance - ui.pinch.distance;

        if (!ui.pinch.applied && Math.abs(diff) > 26) {
          const currentIndex = CHART_RANGES.indexOf(ui.chartRange);
          if (diff > 0 && currentIndex < CHART_RANGES.length - 1) {
            ui.chartRange = CHART_RANGES[currentIndex + 1];
          } else if (diff < 0 && currentIndex > 0) {
            ui.chartRange = CHART_RANGES[currentIndex - 1];
          }
          ui.pinch.applied = true;
          renderCharts();
        }
      }
    },
    { passive: true },
  );

  document.addEventListener("touchend", (event) => {
    if (ui.pinch) {
      ui.pinch = null;
    }

    if (!ui.gestureStart || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const diffX = ui.gestureStart.x - touch.screenX;
    const diffY = ui.gestureStart.y - touch.screenY;
    ui.gestureStart = null;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60 && !ui.summaryOpen) {
      if (diffX > 0) {
        setActiveScreen(ui.activeScreen + 1);
      } else {
        setActiveScreen(ui.activeScreen - 1);
      }
      return;
    }

    if (diffY > 80 && ui.summaryOpen) {
      toggleSummary(false);
      return;
    }

    if (diffY < -80 && !ui.summaryOpen) {
      toggleSummary(true);
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.location.protocol.startsWith("http")) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}

function cacheDom() {
  dom.screenTitle = document.getElementById("screen-title");
  dom.runtimeStatus = document.getElementById("runtime-status");
  dom.screenDots = [...document.querySelectorAll(".screen-dot")];
  dom.screens = [...document.querySelectorAll(".screen")];
  dom.openSummaryButton = document.getElementById("open-summary-button");
  dom.closeSummaryButton = document.getElementById("close-summary-button");
  dom.openSettingsButton = document.getElementById("open-settings-button");
  dom.closeSettingsButton = document.getElementById("close-settings-button");
  dom.textEntryInput = document.getElementById("text-entry-input");
  dom.activityContextInput = document.getElementById("activity-context-input");
  dom.moodContextInput = document.getElementById("mood-context-input");
  dom.textSubmitButton = document.getElementById("text-submit-button");
  dom.activitySubmitButton = document.getElementById("activity-submit-button");
  dom.moodSubmitButton = document.getElementById("mood-submit-button");
  dom.questionSubmitButton = document.getElementById("question-submit-button");
  dom.textMicButton = document.getElementById("text-mic-button");
  dom.moodMicButton = document.getElementById("mood-mic-button");
  dom.questionMicButton = document.getElementById("question-mic-button");
  dom.activityGrid = document.getElementById("activity-grid");
  dom.moodGrid = document.getElementById("mood-grid");
  dom.moodModeToggle = document.getElementById("mood-mode-toggle");
  dom.moodPrecisionOverlay = document.getElementById("mood-precision-overlay");
  dom.moodDot = document.getElementById("mood-dot");
  dom.nearestWordLabel = document.getElementById("nearest-word-label");
  dom.summaryPanel = document.getElementById("summary-panel");
  dom.summaryTabs = [...document.querySelectorAll(".summary-tab")];
  dom.tabPanels = [...document.querySelectorAll(".tab-panel")];
  dom.timelineTab = document.getElementById("timeline-tab");
  dom.patternsTab = document.getElementById("patterns-tab");
  dom.chartsTab = document.getElementById("charts-tab");
  dom.questionInput = document.getElementById("question-input");
  dom.setupModal = document.getElementById("setup-modal");
  dom.settingsModal = document.getElementById("settings-modal");
  dom.apiKeyInput = document.getElementById("api-key-input");
  dom.saveApiKeyButton = document.getElementById("save-api-key-button");
  dom.skipApiKeyButton = document.getElementById("skip-api-key-button");
  dom.settingsApiKeyInput = document.getElementById("settings-api-key-input");
  dom.updateApiKeyButton = document.getElementById("update-api-key-button");
  dom.customButtonName = document.getElementById("custom-button-name");
  dom.customButtonType = document.getElementById("custom-button-type");
  dom.addCustomButtonButton = document.getElementById("add-custom-button-button");
  dom.buttonList = document.getElementById("button-list");
  dom.exportDataButton = document.getElementById("export-data-button");
  dom.importDataButton = document.getElementById("import-data-button");
  dom.importDataInput = document.getElementById("import-data-input");
  dom.toast = document.getElementById("toast");
}

function init() {
  cacheDom();
  syncDerivedState();
  bindEvents();
  renderAll();
  registerServiceWorker();
}

init();
