(() => {
const MOOD_WORD_GRID = [
  ["Enraged", "Panicked", "Stressed", "Jittery", "Shocked", "Surprised", "Upbeat", "Festive", "Exhilarated", "Ecstatic"],
  ["Livid", "Furious", "Frustrated", "Tense", "Stunned", "Hyper", "Cheerful", "Motivated", "Inspired", "Elated"],
  ["Fuming", "Frightened", "Angry", "Nervous", "Restless", "Energized", "Lively", "Excited", "Optimistic", "Enthusiastic"],
  ["Anxious", "Apprehensive", "Worried", "Irritated", "Annoyed", "Pleased", "Focused", "Happy", "Proud", "Thrilled"],
  ["Repulsed", "Troubled", "Concerned", "Uneasy", "Peeved", "Pleasant", "Joyful", "Hopeful", "Playful", "Blissful"],
  ["Disgusted", "Glum", "Disappointed", "Down", "Apathetic", "At Ease", "Easygoing", "Content", "Loving", "Fulfilled"],
  ["Pessimistic", "Morose", "Discouraged", "Sad", "Bored", "Calm", "Secure", "Satisfied", "Grateful", "Touched"],
  ["Alienated", "Miserable", "Lonely", "Disheartened", "Tired", "Relaxed", "Chill", "Restful", "Blessed", "Balanced"],
  ["Despondent", "Depressed", "Sullen", "Exhausted", "Fatigued", "Mellow", "Thoughtful", "Peaceful", "Comfortable", "Carefree"],
  ["Despair", "Hopeless", "Desolate", "Spent", "Drained", "Sleepy", "Complacent", "Tranquil", "Cozy", "Serene"],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeActivityName(name = "") {
  return String(name).trim().toLowerCase();
}

function titleCase(value = "") {
  return String(value)
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getDayKey(timestamp) {
  return new Date(timestamp).toISOString().split("T")[0];
}

function getDisplayTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatDayLabel(dayKey) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dayKey}T12:00:00`));
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function getDayMoodPoints(dayMap, dayKey) {
  return dayMap[dayKey] && dayMap[dayKey].moods ? dayMap[dayKey].moods : [];
}

function getDayActivities(dayMap, dayKey) {
  return dayMap[dayKey] && dayMap[dayKey].activities ? dayMap[dayKey].activities : {};
}

function getDayEntries(dayMap, dayKey) {
  return dayMap[dayKey] && dayMap[dayKey].entries ? dayMap[dayKey].entries : [];
}

function formatAverage(value, fallback) {
  return value === null || value === undefined ? fallback : value.toFixed(1);
}

function getLastNDays(count) {
  const days = [];
  const current = new Date();
  current.setHours(12, 0, 0, 0);

  for (let index = 0; index < count; index += 1) {
    const day = new Date(current);
    day.setDate(current.getDate() - index);
    days.push(day.toISOString().split("T")[0]);
  }

  return days;
}

function entryActivities(entry) {
  if (!entry || !entry.data) return {};

  if (entry.type === "activity") {
    return entry.data.activities || {};
  }

  if (entry.type === "text") {
    return (entry.data.parsed_data && entry.data.parsed_data.activities) || {};
  }

  if (entry.type === "mood") {
    return (entry.data.parsed_text && entry.data.parsed_text.activities) || {};
  }

  return {};
}

function extractMoodPoints(entry) {
  if (!entry || !entry.data) return [];

  if (entry.type === "mood" && entry.data.mood_data && entry.data.mood_data.coordinates) {
    return [
      {
        pleasantness: entry.data.mood_data.pleasantness,
        energy: entry.data.mood_data.energy,
        label: entry.data.mood_data.word || findNearestMoodWord(entry.data.mood_data.coordinates).word,
        timestamp: entry.timestamp,
      },
    ];
  }

  const parsedMood =
    (entry.data.parsed_data && entry.data.parsed_data.mood) ||
    (entry.data.parsed_context && entry.data.parsed_context.mood);

  if (
    parsedMood &&
    (Number.isFinite(parsedMood.energy_level) || Number.isFinite(parsedMood.pleasantness))
  ) {
    const pleasantness = Number.isFinite(parsedMood.pleasantness)
      ? clamp(parsedMood.pleasantness / 10, 0, 1)
      : null;
    const energy = Number.isFinite(parsedMood.energy_level)
      ? clamp(parsedMood.energy_level / 10, 0, 1)
      : null;

    if (pleasantness !== null || energy !== null) {
      return [
        {
          pleasantness,
          energy,
          label: (parsedMood.feelings && parsedMood.feelings[0]) || "Text note",
          timestamp: entry.timestamp,
        },
      ];
    }
  }

  return [];
}

function extractFeelingLabels(entry) {
  const labels = [];
  const add = (value) => {
    if (value && !labels.includes(value)) {
      labels.push(value);
    }
  };

  const parsedFeelingSets = [
    entry && entry.data && entry.data.parsed_data && entry.data.parsed_data.mood
      ? entry.data.parsed_data.mood.feelings
      : null,
    entry && entry.data && entry.data.parsed_context && entry.data.parsed_context.mood
      ? entry.data.parsed_context.mood.feelings
      : null,
    entry && entry.data && entry.data.parsed_text && entry.data.parsed_text.mood
      ? entry.data.parsed_text.mood.feelings
      : null,
  ];

  parsedFeelingSets.forEach((set) => {
    (set || []).forEach(add);
  });

  if (entry && entry.type === "mood" && entry.data && entry.data.mood_data && entry.data.mood_data.word) {
    add(entry.data.mood_data.word);
  }

  return labels;
}

function extractObservations(entry) {
  const notes = [];

  [
    entry && entry.data && entry.data.parsed_data ? entry.data.parsed_data.observations : null,
    entry && entry.data && entry.data.parsed_context ? entry.data.parsed_context.observations : null,
    entry && entry.data && entry.data.parsed_text ? entry.data.parsed_text.observations : null,
  ].forEach((note) => {
    if (note) notes.push(note);
  });

  if (entry && entry.type === "activity" && entry.data && entry.data.context) {
    notes.push(entry.data.context);
  }

  if (entry && entry.type === "mood" && entry.data && entry.data.text_input) {
    notes.push(entry.data.text_input);
  }

  return notes.filter(Boolean);
}

function buildDayMap(entries) {
  const dayMap = {};

  entries.forEach((entry) => {
    const dayKey = getDayKey(entry.timestamp);

    if (!dayMap[dayKey]) {
      dayMap[dayKey] = {
        dayKey,
        entries: [],
        activities: {},
        moods: [],
        feelings: [],
        notes: [],
      };
    }

    const day = dayMap[dayKey];
    day.entries.push(entry);

    Object.entries(entryActivities(entry)).forEach(([name, count]) => {
      const key = normalizeActivityName(name);
      const numericCount = typeof count === "boolean" ? (count ? 1 : 0) : Number(count) || 0;
      day.activities[key] = (day.activities[key] || 0) + numericCount;
    });

    extractMoodPoints(entry).forEach((point) => {
      day.moods.push(point);
    });

    extractFeelingLabels(entry).forEach((label) => {
      if (!day.feelings.includes(label)) day.feelings.push(label);
    });

    extractObservations(entry).forEach((note) => {
      if (!day.notes.includes(note)) day.notes.push(note);
    });
  });

  return dayMap;
}

function buildTimelineDays(entries, count = 7) {
  const days = getLastNDays(count);
  const dayMap = buildDayMap(entries);

  return days.map((dayKey) => {
    const day = dayMap[dayKey];

    if (!day) {
      return {
        dayKey,
        label: formatDayLabel(dayKey),
        activities: [],
        moods: [],
        notes: [],
      };
    }

    const activities = Object.entries(day.activities)
      .sort((left, right) => right[1] - left[1])
      .map(([name, value]) => ({
        name: titleCase(name),
        value,
      }));

    const moods = day.entries.flatMap((entry) => {
      const labels = [];
      const seen = new Set();
      extractFeelingLabels(entry).forEach((label) => {
        const normalized = label.toLowerCase();
        if (seen.has(normalized)) return;
        seen.add(normalized);
        labels.push({ label: titleCase(label), time: getDisplayTime(entry.timestamp) });
      }

      return labels;
    });

    return {
      dayKey,
      label: formatDayLabel(dayKey),
      activities,
      moods,
      notes: day.notes,
    };
  });
}

function getActivityDays(dayMap, activityName, dayKeys) {
  return dayKeys.filter((dayKey) => Boolean(dayMap[dayKey] && dayMap[dayKey].activities && dayMap[dayKey].activities[activityName]));
}

function getActivityUsageCounts(entries, dayLimit = null) {
  const cutoff = dayLimit ? Date.now() - dayLimit * 24 * 60 * 60 * 1000 : null;
  const usage = {};

  entries.forEach((entry) => {
    if (cutoff && new Date(entry.timestamp).getTime() < cutoff) {
      return;
    }

    Object.entries(entryActivities(entry)).forEach(([name, count]) => {
      const key = normalizeActivityName(name);
      const numericCount = typeof count === "boolean" ? (count ? 1 : 0) : Number(count) || 0;
      usage[key] = (usage[key] || 0) + numericCount;
    });
  });

  return usage;
}

function syncButtonsWithUsage(buttons, entries) {
  const lifetimeUsage = getActivityUsageCounts(entries);
  const recentUsage = getActivityUsageCounts(entries, 30);

  return [...buttons]
    .map((button, index) => {
      const key = normalizeActivityName(button.name);
      return {
        ...button,
        usage_count: lifetimeUsage[key] || 0,
        sort_score: recentUsage[key] || 0,
        original_index: index,
      };
    })
    .sort((left, right) => {
      if (right.sort_score !== left.sort_score) {
        return right.sort_score - left.sort_score;
      }
      return left.original_index - right.original_index;
    })
    .map(({ sort_score, original_index, ...button }) => button);
}

function getAutoAddCandidates(entries, buttons, settings) {
  const dayLimit = settings.auto_suggest_window_days || 14;
  const threshold = settings.auto_suggest_threshold || 3;
  const recentUsage = getActivityUsageCounts(entries, dayLimit);
  const existing = new Set(buttons.map((button) => normalizeActivityName(button.name)));
  const hidden = new Set((settings.hidden_buttons || []).map(normalizeActivityName));
  const singleTap = new Set(["cannabis", "alcohol", "tv before bed", "reading before bed", "made dinner"]);

  return Object.entries(recentUsage)
    .filter(([name, count]) => count >= threshold && !existing.has(name) && !hidden.has(name))
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => ({
      name: titleCase(name),
      type: singleTap.has(name) ? "single-tap" : "multi-tap",
      auto_added: true,
    }));
}

function computePatternInsights(entries) {
  const dayMap = buildDayMap(entries);
  const weekDays = getLastNDays(7);
  const monthDays = getLastNDays(30);
  const weekUsage = getActivityUsageCounts(entries, 7);
  const monthUsage = getActivityUsageCounts(entries, 30);
  const insights = [];

  Object.entries(weekUsage)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .forEach(([name, count]) => {
      insights.push(`${titleCase(name)}: ${count} time${count === 1 ? "" : "s"} in the past 7 days.`);
    });

  Object.entries(monthUsage)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .forEach(([name, count]) => {
      insights.push(`${titleCase(name)}: ${count} time${count === 1 ? "" : "s"} in the past 30 days.`);
    });

  const exerciseDays = getActivityDays(dayMap, "exercise", monthDays);
  const nonExerciseDays = monthDays.filter((dayKey) => !exerciseDays.includes(dayKey));
  const exerciseEnergy = average(
    exerciseDays.map((dayKey) =>
      average(getDayMoodPoints(dayMap, dayKey).map((point) => (point.energy === null ? null : point.energy * 10))),
    ),
  );
  const nonExerciseEnergy = average(
    nonExerciseDays.map((dayKey) =>
      average(getDayMoodPoints(dayMap, dayKey).map((point) => (point.energy === null ? null : point.energy * 10))),
    ),
  );

  if (exerciseEnergy !== null || nonExerciseEnergy !== null) {
    insights.push(
      `Exercise days: average energy ${formatAverage(exerciseEnergy, "n/a")}/10. Days without exercise: average energy ${formatAverage(nonExerciseEnergy, "n/a")}/10.`,
    );
  }

  const cannabisDays = getActivityDays(dayMap, "cannabis", monthDays);
  const nextDayPleasantness = cannabisDays
    .map((dayKey) => {
      const nextDay = new Date(`${dayKey}T12:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayKey = nextDay.toISOString().split("T")[0];
      return average(
        getDayMoodPoints(dayMap, nextDayKey).map((point) =>
          point.pleasantness === null ? null : point.pleasantness * 10,
        ),
      );
    })
    .filter((value) => value !== null);

  const noCannabisDays = monthDays.filter((dayKey) => !cannabisDays.includes(dayKey));
  const noCannabisNextDayPleasantness = noCannabisDays
    .map((dayKey) => {
      const nextDay = new Date(`${dayKey}T12:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayKey = nextDay.toISOString().split("T")[0];
      return average(
        getDayMoodPoints(dayMap, nextDayKey).map((point) =>
          point.pleasantness === null ? null : point.pleasantness * 10,
        ),
      );
    })
    .filter((value) => value !== null);

  if (nextDayPleasantness.length || noCannabisNextDayPleasantness.length) {
    insights.push(
      `Days after cannabis: average pleasantness ${formatAverage(average(nextDayPleasantness), "n/a")}/10. Days after no cannabis: average pleasantness ${formatAverage(average(noCannabisNextDayPleasantness), "n/a")}/10.`,
    );
  }

  const highCoffeeDays = monthDays.filter((dayKey) => (getDayActivities(dayMap, dayKey).coffee || 0) > 2);
  const eveningLabels = highCoffeeDays.flatMap((dayKey) =>
    getDayEntries(dayMap, dayKey)
      .filter((entry) => new Date(entry.timestamp).getHours() >= 17)
      .flatMap((entry) => extractFeelingLabels(entry)),
  );

  if (highCoffeeDays.length && eveningLabels.length) {
    const counts = eveningLabels.reduce((accumulator, label) => {
      accumulator[label] = (accumulator[label] || 0) + 1;
      return accumulator;
    }, {});
    const topLabels = Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([label]) => titleCase(label))
      .join(", ");
    insights.push(`Days with coffee above 2 entries often include evening words such as ${topLabels}.`);
  }

  const weekendKeys = monthDays.filter((dayKey) => {
    const day = new Date(`${dayKey}T12:00:00`).getDay();
    return day === 0 || day === 6;
  });
  const weekdayKeys = monthDays.filter((dayKey) => !weekendKeys.includes(dayKey));
  const weekendCannabis = average(weekendKeys.map((dayKey) => (getDayActivities(dayMap, dayKey).cannabis ? 1 : 0)));
  const weekdayCannabis = average(weekdayKeys.map((dayKey) => (getDayActivities(dayMap, dayKey).cannabis ? 1 : 0)));

  if (weekendCannabis !== null || weekdayCannabis !== null) {
    insights.push(
      `Weekends: cannabis on ${formatAverage(weekendCannabis === null ? null : weekendCannabis * 7, "0.0")} days per week pace. Weekdays: cannabis on ${formatAverage(weekdayCannabis === null ? null : weekdayCannabis * 7, "0.0")} days per week pace.`,
    );
  }

  return insights;
}

function buildChartData(entries, rangeDays = 30) {
  const dayMap = buildDayMap(entries);
  const days = getLastNDays(rangeDays).reverse();

  const energySeries = days.map((dayKey) => ({
    dayKey,
    label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      new Date(`${dayKey}T12:00:00`),
    ),
    value: average(
      getDayMoodPoints(dayMap, dayKey).map((point) => (point.energy === null ? null : point.energy * 10)),
    ),
  }));

  const pleasantnessSeries = days.map((dayKey) => ({
    dayKey,
    label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      new Date(`${dayKey}T12:00:00`),
    ),
    value: average(
      getDayMoodPoints(dayMap, dayKey).map((point) =>
        point.pleasantness === null ? null : point.pleasantness * 10,
      ),
    ),
  }));

  const activitySeries = Object.entries(getActivityUsageCounts(entries, rangeDays))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, value]) => ({ label: titleCase(name), value }));

  const scatterSeries = entries
    .flatMap((entry) =>
      extractMoodPoints(entry).map((point) => ({
        x: point.pleasantness,
        y: point.energy,
        label: point.label,
        dayKey: getDayKey(point.timestamp),
        time: getDisplayTime(point.timestamp),
      })),
    )
    .filter((point) => point.x !== null && point.y !== null)
    .filter((point) => {
      const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
      return new Date(`${point.dayKey}T12:00:00`).getTime() >= cutoff;
    });

  const monthDays = getLastNDays(rangeDays);
  const exerciseDays = getActivityDays(dayMap, "exercise", monthDays);
  const noExerciseDays = monthDays.filter((dayKey) => !exerciseDays.includes(dayKey));
  const cannabisDays = getActivityDays(dayMap, "cannabis", monthDays);
  const noCannabisDays = monthDays.filter((dayKey) => !cannabisDays.includes(dayKey));

  return {
    energySeries,
    pleasantnessSeries,
    activitySeries,
    scatterSeries,
    correlationSeries: [
      {
        label: "Exercise days energy",
        value: average(
          exerciseDays.map((dayKey) =>
            average(
              getDayMoodPoints(dayMap, dayKey).map((point) => (point.energy === null ? null : point.energy * 10)),
            ),
          ),
        ),
      },
      {
        label: "No exercise energy",
        value: average(
          noExerciseDays.map((dayKey) =>
            average(
              getDayMoodPoints(dayMap, dayKey).map((point) => (point.energy === null ? null : point.energy * 10)),
            ),
          ),
        ),
      },
      {
        label: "Cannabis next-day pleasantness",
        value: average(
          cannabisDays.map((dayKey) => {
            const nextDay = new Date(`${dayKey}T12:00:00`);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextKey = nextDay.toISOString().split("T")[0];
            return average(
              getDayMoodPoints(dayMap, nextKey).map((point) =>
                point.pleasantness === null ? null : point.pleasantness * 10,
              ),
            );
          }),
        ),
      },
      {
        label: "No cannabis next-day pleasantness",
        value: average(
          noCannabisDays.map((dayKey) => {
            const nextDay = new Date(`${dayKey}T12:00:00`);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextKey = nextDay.toISOString().split("T")[0];
            return average(
              getDayMoodPoints(dayMap, nextKey).map((point) =>
                point.pleasantness === null ? null : point.pleasantness * 10,
              ),
            );
          }),
        ),
      },
    ],
  };
}

function findNearestMoodWord(coordinates) {
  let bestMatch = {
    word: "Balanced",
    row: 7,
    column: 9,
    distance: Number.POSITIVE_INFINITY,
  };

  MOOD_WORD_GRID.forEach((row, rowIndex) => {
    row.forEach((word, columnIndex) => {
      const center = {
        x: (columnIndex + 0.5) / 10,
        y: 1 - (rowIndex + 0.5) / 10,
      };
      const distance = Math.hypot(center.x - coordinates.x, center.y - coordinates.y);

      if (distance < bestMatch.distance) {
        bestMatch = {
          word,
          row: rowIndex,
          column: columnIndex,
          distance,
        };
      }
    });
  });

  return bestMatch;
}

function answerPatternQuestionLocally(entries, question) {
  const normalized = question.toLowerCase();
  const chartData = buildChartData(entries, normalized.includes("2 week") ? 14 : 30);
  const insights = [];

  if (normalized.includes("cannabis")) {
    const cannabisSeriesItem = chartData.activitySeries.find((item) => item.label === "Cannabis");
    const cannabisCount = cannabisSeriesItem ? cannabisSeriesItem.value : 0;
    insights.push(`Cannabis appeared ${cannabisCount} time${cannabisCount === 1 ? "" : "s"} in the selected window.`);
    const cannabisNextDay = chartData.correlationSeries.find((item) => item.label === "Cannabis next-day pleasantness");
    const noCannabisNextDay = chartData.correlationSeries.find(
      (item) => item.label === "No cannabis next-day pleasantness",
    );
    insights.push(
      `Days after cannabis average pleasantness: ${formatAverage(cannabisNextDay ? cannabisNextDay.value : null, "n/a")}/10. Days after no cannabis: ${formatAverage(noCannabisNextDay ? noCannabisNextDay.value : null, "n/a")}/10.`,
    );
  } else if (normalized.includes("coffee")) {
    const coffeeSeriesItem = chartData.activitySeries.find((item) => item.label === "Coffee");
    const coffeeCount = coffeeSeriesItem ? coffeeSeriesItem.value : 0;
    insights.push(`Coffee appeared ${coffeeCount} time${coffeeCount === 1 ? "" : "s"} in the selected window.`);
    const eveningWords = computePatternInsights(entries).find((line) => line.toLowerCase().includes("coffee"));
    if (eveningWords) insights.push(eveningWords);
  } else if (normalized.includes("patient")) {
    const matches = entries.filter((entry) =>
      extractFeelingLabels(entry).some((label) => label.toLowerCase() === "patient"),
    );
    if (matches.length) {
      const hours = matches.map((entry) => new Date(entry.timestamp).getHours());
      const averageHour = Math.round(hours.reduce((sum, hour) => sum + hour, 0) / hours.length);
      insights.push(`Patient appeared ${matches.length} time${matches.length === 1 ? "" : "s"} in logged entries.`);
      insights.push(`The average timestamp for "patient" entries is around ${averageHour}:00.`);
    } else {
      insights.push(`No entries with the word "patient" are in the current data.`);
    }
  } else if (normalized.includes("weekday") || normalized.includes("weekend")) {
    const weekendLine = computePatternInsights(entries).find((line) => line.startsWith("Weekends:"));
    if (weekendLine) insights.push(weekendLine);
  } else if (normalized.includes("exercise")) {
    const exerciseLine = computePatternInsights(entries).find((line) => line.startsWith("Exercise days:"));
    if (exerciseLine) insights.push(exerciseLine);
  } else {
    insights.push(...computePatternInsights(entries).slice(0, 5));
  }

  return insights;
}

window.Patterns = {
  MOOD_WORD_GRID,
  answerPatternQuestionLocally,
  buildChartData,
  buildDayMap,
  buildTimelineDays,
  computePatternInsights,
  findNearestMoodWord,
  formatDayLabel,
  getActivityUsageCounts,
  getAutoAddCandidates,
  getDayKey,
  syncButtonsWithUsage,
  titleCase,
};
})();
