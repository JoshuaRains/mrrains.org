(function () {
  "use strict";

  const SECTIONS = [
    { code: "C.1", name: "Pronouns", questions: "Questions 1–10", possible: 10 },
    { code: "C.2", name: "Definite Articles", questions: "Questions 11–14", possible: 4 },
    { code: "C.3", name: "Indefinite Articles", questions: "Questions 15–18", possible: 4 },
    { code: "C.4", name: "Verb Meanings", questions: "Questions 19–24", possible: 6 },
    { code: "C.5", name: "Regular Conjugation", questions: "Questions 25–31", possible: 7 },
    { code: "C.6", name: "Conjugation with Different Subjects", questions: "Questions 32–36", possible: 5 },
    { code: "C.7", name: "Gustar", questions: "Questions 37–41", possible: 5 },
    { code: "C.8", name: "Ser vs. Estar", questions: "Questions 42–46", possible: 5 },
    { code: "C.9", name: "Tener", questions: "Questions 47–56", possible: 10 }
  ];

  const TOTAL_POSSIBLE = SECTIONS.reduce((sum, section) => sum + section.possible, 0);

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function calculateSection(earned, possible, remediated, recoveryRate) {
    if (!Number.isFinite(earned) || earned < 0 || earned > possible) {
      return null;
    }

    const rate = clamp(Number(recoveryRate) || 0, 0, 100) / 100;
    const missed = possible - earned;
    const returned = remediated ? missed * rate : 0;

    return {
      earned,
      missed,
      returned,
      updated: Math.min(earned + returned, possible)
    };
  }

  function calculateTotals(entries, recoveryRate) {
    const results = SECTIONS.map((section, index) => {
      const entry = entries[index] || {};
      return calculateSection(entry.earned, section.possible, Boolean(entry.remediated), recoveryRate);
    });
    const complete = results.every(Boolean);

    if (!complete) {
      return { complete: false, results };
    }

    const original = results.reduce((sum, result) => sum + result.earned, 0);
    const returned = results.reduce((sum, result) => sum + result.returned, 0);
    const updated = results.reduce((sum, result) => sum + result.updated, 0);

    return {
      complete: true,
      results,
      original,
      returned,
      updated,
      originalPercent: original / TOTAL_POSSIBLE * 100,
      updatedPercent: updated / TOTAL_POSSIBLE * 100
    };
  }

  function formatNumber(value, maximumFractionDigits = 2) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(value);
  }

  function formatPercent(value) {
    return `${formatNumber(value, 1)}%`;
  }

  function initialize() {
    const sectionRows = document.getElementById("sectionRows");
    if (!sectionRows) return;

    const template = document.getElementById("sectionRowTemplate");
    const recoveryRateInput = document.getElementById("recoveryRate");
    const fillFullCreditButton = document.getElementById("fillFullCreditButton");
    const resetButton = document.getElementById("resetButton");
    const copyButton = document.getElementById("copyButton");
    const copyStatus = document.getElementById("copyStatus");
    const rowElements = [];
    const recoveryRateStorageKey = "q1-progress-quiz-points-back-rate";

    try {
      const savedRateValue = window.localStorage.getItem(recoveryRateStorageKey);
      const savedRate = Number(savedRateValue);
      if (savedRateValue !== null && Number.isFinite(savedRate) && savedRate >= 0 && savedRate <= 100) {
        recoveryRateInput.value = String(savedRate);
      }
    } catch (error) {
      // The calculator still works when browser storage is unavailable.
    }

    SECTIONS.forEach((section, index) => {
      const row = template.content.firstElementChild.cloneNode(true);
      const input = row.querySelector(".section-score");
      const check = row.querySelector(".remediation-check");

      row.dataset.index = String(index);
      row.querySelector(".section-code").textContent = section.code;
      row.querySelector(".section-name").textContent = section.name;
      row.querySelector(".question-range").textContent = section.questions;
      row.querySelector(".possible-points").textContent = `/ ${section.possible}`;
      row.querySelector(".section-input-label").textContent = `${section.name} points earned out of ${section.possible}`;
      input.max = String(section.possible);
      input.id = `section-score-${index}`;
      check.setAttribute("aria-label", `Remediation completed for ${section.name}`);

      input.addEventListener("input", update);
      input.addEventListener("keydown", (event) => {
        if (!event.shiftKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;

        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= SECTIONS.length) return;

        const targetInput = rowElements[targetIndex].querySelector(".section-score");
        targetInput.focus();
        targetInput.select();
      });
      check.addEventListener("change", update);
      sectionRows.appendChild(row);
      rowElements.push(row);
    });

    function readRows() {
      return rowElements.map((row, index) => {
        const input = row.querySelector(".section-score");
        const raw = input.value.trim();
        const value = raw === "" ? NaN : Number(raw);
        const valid = Number.isFinite(value) && value >= 0 && value <= SECTIONS[index].possible;
        const error = row.querySelector(".field-error");

        input.classList.toggle("invalid", raw !== "" && !valid);
        input.setAttribute("aria-invalid", String(raw !== "" && !valid));
        error.textContent = raw !== "" && !valid ? `Use 0–${SECTIONS[index].possible}` : "";

        return {
          earned: valid ? value : NaN,
          remediated: row.querySelector(".remediation-check").checked
        };
      });
    }

    function update() {
      const rate = clamp(Number(recoveryRateInput.value) || 0, 0, 100);
      const entries = readRows();
      const totals = calculateTotals(entries, rate);
      const completedCount = entries.filter((entry) => Number.isFinite(entry.earned)).length;
      const remediatedEntries = entries.filter((entry) => entry.remediated);

      document.getElementById("completionPill").textContent = `${completedCount} of ${SECTIONS.length} scored`;
      document.getElementById("remediationCountCell").textContent = `${remediatedEntries.length} section${remediatedEntries.length === 1 ? "" : "s"}`;

      totals.results.forEach((result, index) => {
        const row = rowElements[index];
        row.querySelector(".points-back-value").textContent = result ? `+${formatNumber(result.returned)}` : "+0";
        row.querySelector(".new-section-value").textContent = result ? `${formatNumber(result.updated)} / ${SECTIONS[index].possible}` : "—";
      });

      const partialOriginal = totals.results.reduce((sum, result) => sum + (result ? result.earned : 0), 0);
      const partialReturned = totals.results.reduce((sum, result) => sum + (result ? result.returned : 0), 0);
      const partialUpdated = partialOriginal + partialReturned;
      document.getElementById("originalTotalCell").textContent = completedCount ? `${formatNumber(partialOriginal)} / ${TOTAL_POSSIBLE}` : `— / ${TOTAL_POSSIBLE}`;
      document.getElementById("pointsBackCell").textContent = `+${formatNumber(partialReturned)}`;
      document.getElementById("newTotalCell").textContent = completedCount ? `${formatNumber(partialUpdated)} / ${TOTAL_POSSIBLE}` : `— / ${TOTAL_POSSIBLE}`;

      const incompleteNotice = document.getElementById("incompleteNotice");
      const resultContent = document.getElementById("resultContent");
      incompleteNotice.hidden = totals.complete;
      resultContent.hidden = !totals.complete;
      copyButton.disabled = !totals.complete;

      if (!totals.complete) {
        const remaining = SECTIONS.length - completedCount;
        incompleteNotice.textContent = `Enter a score for ${remaining} more section${remaining === 1 ? "" : "s"} to calculate the final result.`;
        return;
      }

      document.getElementById("originalResult").textContent = `${formatNumber(totals.original)} / ${TOTAL_POSSIBLE} · ${formatPercent(totals.originalPercent)}`;
      document.getElementById("returnedResult").textContent = `+${formatNumber(totals.returned)}`;
      document.getElementById("newResult").textContent = `${formatNumber(totals.updated)} / ${TOTAL_POSSIBLE} · ${formatPercent(totals.updatedPercent)}`;
      document.getElementById("roundedResult").textContent = `${Math.round(totals.updatedPercent)}%`;
    }

    function resetCalculator() {
      rowElements.forEach((row, index) => {
        row.querySelector(".section-score").value = String(SECTIONS[index].possible);
        row.querySelector(".remediation-check").checked = false;
      });
      copyStatus.textContent = "";
      update();
      rowElements[0].querySelector(".section-score").focus();
    }

    function buildSummary() {
      const entries = readRows();
      const rate = clamp(Number(recoveryRateInput.value) || 0, 0, 100);
      const totals = calculateTotals(entries, rate);
      if (!totals.complete) return "";

      const remediated = entries
        .map((entry, index) => entry.remediated ? SECTIONS[index].code : null)
        .filter(Boolean);

      return [
        `Original: ${formatNumber(totals.original)}/${TOTAL_POSSIBLE} (${formatPercent(totals.originalPercent)})`,
        `Remediation completed: ${remediated.length ? remediated.join(", ") : "None"}`,
        `Points-back rate: ${formatPercent(rate)}`,
        `Points returned: +${formatNumber(totals.returned)}`,
        `New grade: ${formatNumber(totals.updated)}/${TOTAL_POSSIBLE} (${formatPercent(totals.updatedPercent)})`,
        `Rounded new grade: ${Math.round(totals.updatedPercent)}%`
      ].join("\n");
    }

    async function copySummary() {
      const summary = buildSummary();
      if (!summary) return;

      try {
        await navigator.clipboard.writeText(summary);
        copyStatus.textContent = "Summary copied.";
      } catch (error) {
        const textArea = document.createElement("textarea");
        textArea.value = summary;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
        copyStatus.textContent = "Summary copied.";
      }
    }

    function saveRecoveryRate() {
      const rawRate = recoveryRateInput.value.trim();
      const rate = Number(rawRate);
      if (rawRate === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) return;

      try {
        window.localStorage.setItem(recoveryRateStorageKey, String(rate));
      } catch (error) {
        // Ignore storage failures; the current page value remains unchanged.
      }
    }

    recoveryRateInput.addEventListener("input", () => {
      saveRecoveryRate();
      update();
    });
    recoveryRateInput.addEventListener("change", () => {
      recoveryRateInput.value = String(clamp(Number(recoveryRateInput.value) || 0, 0, 100));
      saveRecoveryRate();
      update();
    });
    fillFullCreditButton.addEventListener("click", () => {
      rowElements.forEach((row, index) => {
        row.querySelector(".section-score").value = String(SECTIONS[index].possible);
      });
      update();
    });
    resetButton.addEventListener("click", resetCalculator);
    copyButton.addEventListener("click", copySummary);
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        resetCalculator();
      }
    });

    update();
  }

  const api = { SECTIONS, TOTAL_POSSIBLE, calculateSection, calculateTotals };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.QuarterProgressCalculator = api;
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  }
})();
