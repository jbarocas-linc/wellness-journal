(function () {
  var STORAGE_KEY = "wellness-journal-standalone-v1";
  var SCREEN_TITLES = ["Text Input", "Activity Buttons", "Mood Meter"];
  var DEFAULT_BUTTONS = [
    { id: "dog-walk", name: "Dog walk", type: "multi-tap", usage_count: 0 },
    { id: "coffee", name: "Coffee", type: "multi-tap", usage_count: 0 },
    { id: "adderall", name: "Adderall", type: "multi-tap", usage_count: 0 },
    { id: "cannabis", name: "Cannabis", type: "single-tap", usage_count: 0 },
    { id: "alcohol", name: "Alcohol", type: "single-tap", usage_count: 0 },
    { id: "exercise", name: "Exercise", type: "multi-tap", usage_count: 0 },
    { id: "laundry", name: "Laundry", type: "multi-tap", usage_count: 0 },
    { id: "made-dinner", name: "Made dinner", type: "single-tap", usage_count: 0 },
    { id: "tv-before-bed", name: "TV before bed", type: "single-tap", usage_count: 0 },
    { id: "reading-before-bed", name: "Reading before bed", type: "single-tap", usage_count: 0 }
  ];
  var MOOD_WORD_GRID = [
    ["Enraged", "Panicked", "Stressed", "Jittery", "Shocked", "Surprised", "Upbeat", "Festive", "Exhilarated", "Ecstatic"],
    ["Livid", "Furious", "Frustrated", "Tense", "Stunned", "Hyper", "Cheerful", "Motivated", "Inspired", "Elated"],
    ["Fuming", "Frightened", "Angry", "Nervous", "Restless", "Energized", "Lively", "Excited", "Optimistic", "Enthusiastic"],
    ["Anxious", "Apprehensive", "Worried", "Irritated", "Annoyed", "Pleased", "Focused", "Happy", "Proud", "Thrilled"],
    ["Repulsed", "Troubled", "Concerned", "Uneasy", "Peeved", "Pleasant", "Joyful", "Hopeful", "Playful", "Blissful"],
    ["Disgusted", "Glum", "Disappointed", "Down", "Apathetic", "At Ease", "Easygoing", "Content", "Loving", "Fulfilled"],
    ["Pessimistic", "Morose", "Discouraged", "Sad", "Bored", "Calm", "Secure", "Satisfied", "Grateful", "Touched"],
    ["Alienated", "Miserable", "Lonely", "Disheartened", "Tired", "Relaxed", "Chill", "Restful", "Blessed", "Balanced"],
    ["Despondent", "Depressed", "Sullen", "Exhausted", "Fatigued", "Mellow", "Thoughtful", "Peaceful", "Comfortable", "Carefree"],
    ["Despair", "Hopeless", "Desolate", "Spent", "Drained", "Sleepy", "Complacent", "Tranquil", "Cozy", "Serene"]
  ];

  var state = loadState();
  var ui = {
    activeScreen: 0,
    activeTab: "timeline",
    summaryOpen: false,
    activityDraft: {},
    moodMode: "word",
    selectedMood: null,
    precisionPoint: null,
    timelineDays: 7,
    touchStartX: 0,
    touchStartY: 0
  };
  var dom = {};

  function safeClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setRuntime(statusText, variant, detailText) {
    if (window.__setRuntimeStatus) {
      window.__setRuntimeStatus(statusText, variant, detailText || "");
    }
  }

  function createId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  }

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayKey() {
    return new Date().toISOString().split("T")[0];
  }

  function formatDateLabel(dayKey) {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date(dayKey + "T12:00:00"));
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {
          entries: [],
          buttons: safeClone(DEFAULT_BUTTONS),
          settings: {
            api_key: "",
            setup_complete: true
          }
        };
      }
      var parsed = JSON.parse(raw);
      if (!parsed.buttons || !parsed.buttons.length) {
        parsed.buttons = safeClone(DEFAULT_BUTTONS);
      }
      if (!parsed.entries) {
        parsed.entries = [];
      }
      if (!parsed.settings) {
        parsed.settings = { api_key: "", setup_complete: true };
      }
      return parsed;
    } catch (error) {
      return {
        entries: [],
        buttons: safeClone(DEFAULT_BUTTONS),
        settings: {
          api_key: "",
          setup_complete: true
        }
      };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(function () {
      dom.toast.classList.remove("is-visible");
    }, 2000);
  }

  function simpleParseText(text) {
    var lower = String(text || "").toLowerCase();
    var activities = {};
    var aliases = [
      ["coffee", ["coffee", "coffees"]],
      ["dog walk", ["dog walk", "walked the dog", "walk dog"]],
      ["adderall", ["adderall", "meds", "medication"]],
      ["cannabis", ["cannabis", "weed", "edible", "smoked"]],
      ["alcohol", ["alcohol", "beer", "wine", "drank"]],
      ["exercise", ["exercise", "worked out", "workout", "ran", "run", "yoga"]],
      ["laundry", ["laundry"]],
      ["made dinner", ["made dinner", "cooked"]],
      ["tv before bed", ["tv before bed"]],
      ["reading before bed", ["reading before bed"]]
    ];
    var feelings = [];
    var feelingWords = [
      "patient", "irritable", "focused", "anxious", "calm", "restless", "happy",
      "sad", "tired", "energized", "hopeful", "peaceful", "stressed"
    ];
    var i;
    var j;
    for (i = 0; i < aliases.length; i += 1) {
      var canonical = aliases[i][0];
      var words = aliases[i][1];
      var count = 0;
      for (j = 0; j < words.length; j += 1) {
        if (lower.indexOf(words[j]) !== -1) {
          count += 1;
        }
      }
      if (count > 0) {
        activities[canonical] = count;
      }
    }
    for (i = 0; i < feelingWords.length; i += 1) {
      if (lower.indexOf(feelingWords[i]) !== -1) {
        feelings.push(feelingWords[i]);
      }
    }
    return {
      activities: activities,
      mood: {
        feelings: feelings,
        energy_level: null,
        pleasantness: null
      },
      observations: text || ""
    };
  }

  function createEntry(type, data, rawInput) {
    return {
      id: createId("entry"),
      timestamp: new Date().toISOString(),
      type: type,
      data: data,
      raw_input: rawInput || ""
    };
  }

  function setActiveScreen(index) {
    if (index < 0) index = 0;
    if (index > 2) index = 2;
    ui.activeScreen = index;
    renderNavigation();
  }

  function renderNavigation() {
    var i;
    dom.screenTitle.textContent = SCREEN_TITLES[ui.activeScreen];
    for (i = 0; i < dom.screens.length; i += 1) {
      dom.screens[i].classList.toggle("is-active", i === ui.activeScreen);
      dom.screenDots[i].classList.toggle("is-active", i === ui.activeScreen);
    }
  }

  function openSummary(open) {
    ui.summaryOpen = open;
    dom.summaryPanel.classList.toggle("is-open", open);
    dom.summaryPanel.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      renderSummary();
    }
  }

  function renderActivityGrid() {
    var html = "";
    var totals = getTodayActivityTotals();
    var i;
    for (i = 0; i < state.buttons.length; i += 1) {
      var button = state.buttons[i];
      var draftValue = ui.activityDraft[button.id] || 0;
      var persistedValue = totals[normalizeName(button.name)] || 0;
      var isSelected = button.type === "single-tap" ? Boolean(draftValue) : draftValue > 0;
      var metaText = "";
      if (button.type === "single-tap") {
        metaText = persistedValue || draftValue ? "Logged today" : "Tap to log";
      } else {
        metaText = String(persistedValue + draftValue) + " today";
      }
      html +=
        '<button class="activity-button' +
        (isSelected ? " is-selected" : "") +
        '" data-button-id="' + escapeHtml(button.id) + '" type="button">' +
        '<span class="button-name">' + escapeHtml(button.name) + '</span>' +
        '<span class="button-meta">' + escapeHtml(metaText) + "</span>" +
        "</button>";
    }
    dom.activityGrid.innerHTML = html;

    var nodes = dom.activityGrid.querySelectorAll("[data-button-id]");
    for (i = 0; i < nodes.length; i += 1) {
      bindActivityButton(nodes[i]);
    }
  }

  function bindActivityButton(node) {
    var longPressTimer = null;
    var longTriggered = false;
    node.addEventListener("click", function () {
      if (longTriggered) {
        longTriggered = false;
        return;
      }
      var id = node.getAttribute("data-button-id");
      adjustActivityDraft(id, 1);
    });
    node.addEventListener("pointerdown", function () {
      longTriggered = false;
      window.clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(function () {
        longTriggered = true;
        var id = node.getAttribute("data-button-id");
        adjustActivityDraft(id, -1);
      }, 450);
    });
    node.addEventListener("pointerup", function () {
      window.clearTimeout(longPressTimer);
    });
    node.addEventListener("pointerleave", function () {
      window.clearTimeout(longPressTimer);
    });
    node.addEventListener("contextmenu", function (event) {
      event.preventDefault();
    });
  }

  function adjustActivityDraft(buttonId, delta) {
    var i;
    var button = null;
    for (i = 0; i < state.buttons.length; i += 1) {
      if (state.buttons[i].id === buttonId) {
        button = state.buttons[i];
        break;
      }
    }
    if (!button) return;
    if (button.type === "single-tap") {
      ui.activityDraft[button.id] = delta > 0 ? 1 : 0;
    } else {
      ui.activityDraft[button.id] = Math.max(0, (ui.activityDraft[button.id] || 0) + delta);
    }
    renderActivityGrid();
  }

  function getMoodQuadrantClass(rowIndex, colIndex) {
    var topHalf = rowIndex < 5;
    var rightHalf = colIndex >= 5;
    if (topHalf && !rightHalf) return "quadrant-red";
    if (topHalf && rightHalf) return "quadrant-yellow";
    if (!topHalf && !rightHalf) return "quadrant-blue";
    return "quadrant-green";
  }

  function renderMoodGrid() {
    var html = "";
    var rowIndex;
    var colIndex;
    dom.moodModeToggle.checked = ui.moodMode === "precision";
    dom.moodGrid.classList.toggle("is-precision", ui.moodMode === "precision");
    dom.moodPrecisionOverlay.classList.toggle("is-active", ui.moodMode === "precision");
    for (rowIndex = 0; rowIndex < MOOD_WORD_GRID.length; rowIndex += 1) {
      for (colIndex = 0; colIndex < MOOD_WORD_GRID[rowIndex].length; colIndex += 1) {
        var word = MOOD_WORD_GRID[rowIndex][colIndex];
        var selected = ui.selectedMood && ui.selectedMood.word === word;
        html +=
          '<button class="mood-cell ' + getMoodQuadrantClass(rowIndex, colIndex) +
          (selected ? " is-selected" : "") +
          '" data-word="' + escapeHtml(word) + '" data-row="' + rowIndex + '" data-col="' + colIndex + '" type="button">' +
          escapeHtml(word) +
          "</button>";
      }
    }
    dom.moodGrid.innerHTML = html;
    var cells = dom.moodGrid.querySelectorAll("[data-word]");
    for (rowIndex = 0; rowIndex < cells.length; rowIndex += 1) {
      cells[rowIndex].addEventListener("click", function () {
        if (ui.moodMode === "precision") return;
        var row = Number(this.getAttribute("data-row"));
        var col = Number(this.getAttribute("data-col"));
        ui.selectedMood = {
          word: this.getAttribute("data-word"),
          coordinates: {
            x: (col + 0.5) / 10,
            y: 1 - ((row + 0.5) / 10)
          }
        };
        ui.precisionPoint = null;
        renderMoodGrid();
      });
    }
    renderPrecisionDot();
  }

  function nearestMoodWord(point) {
    var best = { word: "Balanced", distance: Infinity };
    var rowIndex;
    var colIndex;
    for (rowIndex = 0; rowIndex < MOOD_WORD_GRID.length; rowIndex += 1) {
      for (colIndex = 0; colIndex < MOOD_WORD_GRID[rowIndex].length; colIndex += 1) {
        var cx = (colIndex + 0.5) / 10;
        var cy = 1 - ((rowIndex + 0.5) / 10);
        var dx = cx - point.x;
        var dy = cy - point.y;
        var distance = Math.sqrt((dx * dx) + (dy * dy));
        if (distance < best.distance) {
          best = { word: MOOD_WORD_GRID[rowIndex][colIndex], distance: distance };
        }
      }
    }
    return best.word;
  }

  function renderPrecisionDot() {
    var point = ui.moodMode === "precision" ? ui.precisionPoint : (ui.selectedMood ? ui.selectedMood.coordinates : null);
    if (!point) {
      dom.moodDot.hidden = true;
      dom.nearestWordLabel.hidden = true;
      return;
    }
    dom.moodDot.hidden = false;
    dom.nearestWordLabel.hidden = false;
    dom.moodDot.style.left = (point.x * 100) + "%";
    dom.moodDot.style.top = ((1 - point.y) * 100) + "%";
    dom.nearestWordLabel.style.left = (point.x * 100) + "%";
    dom.nearestWordLabel.style.top = ((1 - point.y) * 100) + "%";
    dom.nearestWordLabel.textContent = nearestMoodWord(point);
  }

  function handlePrecisionPointer(event) {
    if (ui.moodMode !== "precision") return;
    var rect = dom.moodPrecisionOverlay.getBoundingClientRect();
    var x = (event.clientX - rect.left) / rect.width;
    var y = 1 - ((event.clientY - rect.top) / rect.height);
    if (x < 0) x = 0;
    if (x > 1) x = 1;
    if (y < 0) y = 0;
    if (y > 1) y = 1;
    ui.precisionPoint = { x: x, y: y };
    ui.selectedMood = null;
    renderPrecisionDot();
  }

  function getTodayActivityTotals() {
    var totals = {};
    var day = todayKey();
    var i;
    for (i = 0; i < state.entries.length; i += 1) {
      var entry = state.entries[i];
      if (entry.timestamp.split("T")[0] !== day) continue;
      var activities = null;
      if (entry.type === "activity") {
        activities = entry.data.activities || {};
      } else if (entry.type === "text") {
        activities = entry.data.parsed_data ? entry.data.parsed_data.activities : {};
      } else if (entry.type === "mood") {
        activities = entry.data.parsed_text ? entry.data.parsed_text.activities : {};
      }
      if (!activities) activities = {};
      var keys = Object.keys(activities);
      var j;
      for (j = 0; j < keys.length; j += 1) {
        var key = normalizeName(keys[j]);
        totals[key] = (totals[key] || 0) + Number(activities[keys[j]] || 0);
      }
    }
    return totals;
  }

  function submitTextEntry() {
    var raw = dom.textEntryInput.value.trim();
    if (!raw) {
      showToast("Add a note before submitting.");
      return;
    }
    state.entries.push(createEntry("text", { parsed_data: simpleParseText(raw) }, raw));
    dom.textEntryInput.value = "";
    saveState();
    renderSummary();
    showToast("Entry saved.");
  }

  function submitActivityEntry() {
    var context = dom.activityContextInput.value.trim();
    var activities = {};
    var i;
    for (i = 0; i < state.buttons.length; i += 1) {
      var button = state.buttons[i];
      var draft = ui.activityDraft[button.id] || 0;
      if (!draft) continue;
      activities[normalizeName(button.name)] = button.type === "single-tap" ? 1 : draft;
      button.usage_count += button.type === "single-tap" ? 1 : draft;
    }
    if (!Object.keys(activities).length && !context) {
      showToast("Select a button or add context.");
      return;
    }
    state.entries.push(createEntry("activity", {
      activities: activities,
      context: context,
      parsed_context: context ? simpleParseText(context) : null
    }, context));
    ui.activityDraft = {};
    dom.activityContextInput.value = "";
    saveState();
    renderActivityGrid();
    renderSummary();
    showToast("Activity entry saved.");
  }

  function submitMoodEntry() {
    var text = dom.moodContextInput.value.trim();
    var point = ui.moodMode === "precision" ? ui.precisionPoint : (ui.selectedMood ? ui.selectedMood.coordinates : null);
    var word = null;
    if (ui.moodMode === "word") {
      word = ui.selectedMood ? ui.selectedMood.word : null;
    } else if (point) {
      word = nearestMoodWord(point);
    }
    if (!point && !text) {
      showToast("Select a mood point or add context.");
      return;
    }
    state.entries.push(createEntry("mood", {
      mood_data: point ? {
        method: ui.moodMode === "precision" ? "precision" : "word_select",
        word: word,
        coordinates: point,
        pleasantness: point.x,
        energy: point.y
      } : null,
      text_input: text,
      parsed_text: text ? simpleParseText(text) : null
    }, text));
    dom.moodContextInput.value = "";
    ui.selectedMood = null;
    ui.precisionPoint = null;
    saveState();
    renderMoodGrid();
    renderSummary();
    showToast("Mood entry saved.");
  }

  function buildDayMap() {
    var map = {};
    var i;
    for (i = 0; i < state.entries.length; i += 1) {
      var entry = state.entries[i];
      var day = entry.timestamp.split("T")[0];
      if (!map[day]) {
        map[day] = { activities: {}, moods: [], notes: [], entries: [] };
      }
      map[day].entries.push(entry);
      if (entry.type === "activity") {
        addActivitiesToMap(map[day].activities, entry.data.activities || {});
        if (entry.data.context) map[day].notes.push(entry.data.context);
      }
      if (entry.type === "text") {
        addActivitiesToMap(map[day].activities, entry.data.parsed_data ? entry.data.parsed_data.activities : {});
        if (entry.raw_input) map[day].notes.push(entry.raw_input);
      }
      if (entry.type === "mood") {
        if (entry.data.mood_data) {
          map[day].moods.push({
            label: entry.data.mood_data.word || nearestMoodWord(entry.data.mood_data.coordinates),
            time: formatTime(entry.timestamp),
            pleasantness: entry.data.mood_data.pleasantness,
            energy: entry.data.mood_data.energy
          });
        }
        if (entry.data.text_input) map[day].notes.push(entry.data.text_input);
      }
    }
    return map;
  }

  function addActivitiesToMap(target, source) {
    var keys = Object.keys(source || {});
    var i;
    for (i = 0; i < keys.length; i += 1) {
      var key = normalizeName(keys[i]);
      target[key] = (target[key] || 0) + Number(source[keys[i]] || 0);
    }
  }

  function renderTimeline() {
    var dayMap = buildDayMap();
    var html = '<div class="timeline-list">';
    var i;
    for (i = 0; i < ui.timelineDays; i += 1) {
      var day = new Date();
      day.setHours(12, 0, 0, 0);
      day.setDate(day.getDate() - i);
      var dayKey = day.toISOString().split("T")[0];
      var item = dayMap[dayKey] || { activities: {}, moods: [], notes: [] };
      var activityKeys = Object.keys(item.activities);
      var activityText = activityKeys.length ? activityKeys.map(function (key) {
        return key.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + " (" + item.activities[key] + ")";
      }).join(", ") : "No activity entries";
      var moodText = item.moods.length ? item.moods.map(function (mood) {
        return mood.label + " (" + mood.time + ")";
      }).join(", ") : "No mood entries";
      var notesText = item.notes.length ? item.notes.map(function (note) {
        return "<li>" + escapeHtml(note) + "</li>";
      }).join("") : "<li>No additional notes.</li>";
      html +=
        '<article class="timeline-day">' +
        "<h3>" + escapeHtml(formatDateLabel(dayKey)) + "</h3>" +
        '<p class="timeline-meta"><strong>Activities:</strong> ' + escapeHtml(activityText) + "</p>" +
        '<p class="timeline-meta"><strong>Mood:</strong> ' + escapeHtml(moodText) + "</p>" +
        "<details><summary>Notes</summary><ul>" + notesText + "</ul></details>" +
        "</article>";
    }
    html += '</div><button id="load-earlier-button" class="secondary-button" type="button">Load earlier days</button>';
    dom.timelineTab.innerHTML = html;
    var loadButton = document.getElementById("load-earlier-button");
    if (loadButton) {
      loadButton.addEventListener("click", function () {
        ui.timelineDays += 7;
        renderTimeline();
      });
    }
  }

  function renderPatterns() {
    var dayMap = buildDayMap();
    var days = Object.keys(dayMap);
    var exerciseDays = 0;
    var cannabisDays = 0;
    var coffeeCount = 0;
    var i;
    for (i = 0; i < days.length; i += 1) {
      var activities = dayMap[days[i]].activities;
      if (activities.exercise) exerciseDays += 1;
      if (activities.cannabis) cannabisDays += 1;
      coffeeCount += Number(activities.coffee || 0);
    }
    dom.patternsTab.innerHTML =
      '<div class="pattern-list">' +
      '<article class="pattern-card"><p>Exercise appeared on ' + exerciseDays + ' logged day' + (exerciseDays === 1 ? "" : "s") + '.</p></article>' +
      '<article class="pattern-card"><p>Cannabis appeared on ' + cannabisDays + ' logged day' + (cannabisDays === 1 ? "" : "s") + '.</p></article>' +
      '<article class="pattern-card"><p>Coffee appeared ' + coffeeCount + ' time' + (coffeeCount === 1 ? "" : "s") + ' across saved entries.</p></article>' +
      '<article class="pattern-card"><p>Absence is preserved too. Days without logs remain empty in the timeline.</p></article>' +
      "</div>";
  }

  function renderCharts() {
    var dayMap = buildDayMap();
    var days = Object.keys(dayMap).sort();
    var moodDots = [];
    var i;
    for (i = 0; i < days.length; i += 1) {
      var moods = dayMap[days[i]].moods;
      var j;
      for (j = 0; j < moods.length; j += 1) {
        moodDots.push(moods[j]);
      }
    }
    dom.chartsTab.innerHTML =
      '<div class="chart-grid">' +
      '<article class="chart-card"><h3>Saved days</h3><p class="chart-caption">' + days.length + ' days with at least one entry.</p></article>' +
      '<article class="chart-card"><h3>Mood points</h3><p class="chart-caption">' + moodDots.length + ' mood point' + (moodDots.length === 1 ? "" : "s") + ' saved.</p></article>' +
      "</div>";
  }

  function renderSummary() {
    renderTimeline();
    renderPatterns();
    renderCharts();
    var tabs = dom.summaryTabs;
    var i;
    for (i = 0; i < tabs.length; i += 1) {
      var active = tabs[i].getAttribute("data-tab") === ui.activeTab;
      tabs[i].classList.toggle("is-active", active);
    }
    dom.timelineTab.classList.toggle("is-active", ui.activeTab === "timeline");
    dom.patternsTab.classList.toggle("is-active", ui.activeTab === "patterns");
    dom.chartsTab.classList.toggle("is-active", ui.activeTab === "charts");
  }

  function startVoiceInput(target) {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice input not supported here.");
      return;
    }
    var recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = function (event) {
      if (event && event.results && event.results[0] && event.results[0][0]) {
        target.value = event.results[0][0].transcript;
      }
    };
    recognition.onerror = function () {
      showToast("Voice input did not complete.");
    };
    recognition.start();
  }

  function bindEvents() {
    var i;
    for (i = 0; i < dom.screenDots.length; i += 1) {
      (function (index) {
        dom.screenDots[index].addEventListener("click", function () {
          setActiveScreen(index);
        });
      })(i);
    }

    dom.textSubmitButton.addEventListener("click", submitTextEntry);
    dom.activitySubmitButton.addEventListener("click", submitActivityEntry);
    dom.moodSubmitButton.addEventListener("click", submitMoodEntry);

    dom.textMicButton.addEventListener("click", function () { startVoiceInput(dom.textEntryInput); });
    dom.moodMicButton.addEventListener("click", function () { startVoiceInput(dom.moodContextInput); });
    dom.questionMicButton.addEventListener("click", function () { startVoiceInput(dom.questionInput); });

    dom.openSummaryButton.addEventListener("click", function () { openSummary(true); });
    dom.closeSummaryButton.addEventListener("click", function () { openSummary(false); });

    dom.summaryTabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        ui.activeTab = tab.getAttribute("data-tab");
        renderSummary();
      });
    });

    dom.moodModeToggle.addEventListener("change", function () {
      ui.moodMode = dom.moodModeToggle.checked ? "precision" : "word";
      renderMoodGrid();
    });

    dom.moodPrecisionOverlay.addEventListener("pointerdown", handlePrecisionPointer);
    dom.moodPrecisionOverlay.addEventListener("pointermove", function (event) {
      if (event.buttons) {
        handlePrecisionPointer(event);
      }
    });

    document.addEventListener("touchstart", function (event) {
      if (!event.touches || event.touches.length !== 1) return;
      ui.touchStartX = event.touches[0].screenX;
      ui.touchStartY = event.touches[0].screenY;
    }, { passive: true });

    document.addEventListener("touchend", function (event) {
      if (!event.changedTouches || event.changedTouches.length !== 1) return;
      var endX = event.changedTouches[0].screenX;
      var endY = event.changedTouches[0].screenY;
      var diffX = ui.touchStartX - endX;
      var diffY = ui.touchStartY - endY;
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60 && !ui.summaryOpen) {
        if (diffX > 0) setActiveScreen(ui.activeScreen + 1);
        if (diffX < 0) setActiveScreen(ui.activeScreen - 1);
      }
      if (diffY < -80 && !ui.summaryOpen) {
        openSummary(true);
      }
      if (diffY > 80 && ui.summaryOpen) {
        openSummary(false);
      }
    }, { passive: true });
  }

  function cacheDom() {
    dom.screenTitle = document.getElementById("screen-title");
    dom.screenDots = Array.prototype.slice.call(document.querySelectorAll(".screen-dot"));
    dom.screens = Array.prototype.slice.call(document.querySelectorAll(".screen"));
    dom.textEntryInput = document.getElementById("text-entry-input");
    dom.activityContextInput = document.getElementById("activity-context-input");
    dom.moodContextInput = document.getElementById("mood-context-input");
    dom.textSubmitButton = document.getElementById("text-submit-button");
    dom.activitySubmitButton = document.getElementById("activity-submit-button");
    dom.moodSubmitButton = document.getElementById("mood-submit-button");
    dom.textMicButton = document.getElementById("text-mic-button");
    dom.moodMicButton = document.getElementById("mood-mic-button");
    dom.questionMicButton = document.getElementById("question-mic-button");
    dom.activityGrid = document.getElementById("activity-grid");
    dom.moodGrid = document.getElementById("mood-grid");
    dom.moodModeToggle = document.getElementById("mood-mode-toggle");
    dom.moodPrecisionOverlay = document.getElementById("mood-precision-overlay");
    dom.moodDot = document.getElementById("mood-dot");
    dom.nearestWordLabel = document.getElementById("nearest-word-label");
    dom.openSummaryButton = document.getElementById("open-summary-button");
    dom.closeSummaryButton = document.getElementById("close-summary-button");
    dom.summaryPanel = document.getElementById("summary-panel");
    dom.summaryTabs = Array.prototype.slice.call(document.querySelectorAll(".summary-tab"));
    dom.timelineTab = document.getElementById("timeline-tab");
    dom.patternsTab = document.getElementById("patterns-tab");
    dom.chartsTab = document.getElementById("charts-tab");
    dom.questionInput = document.getElementById("question-input");
    dom.toast = document.getElementById("toast");
  }

  function init() {
    cacheDom();
    bindEvents();
    renderNavigation();
    renderActivityGrid();
    renderMoodGrid();
    renderSummary();
    setRuntime("Interactive", "is-live", "");
  }

  try {
    init();
  } catch (error) {
    setRuntime("Runtime error", "is-error", error && error.message ? error.message : String(error));
  }
})();
