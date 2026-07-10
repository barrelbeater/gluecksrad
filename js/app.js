(() => {
  "use strict";

  const STORAGE_KEY = "stimmrad-state-v1";
  const MIN_OPTIONS = 2;
  const MAX_OPTIONS = 8;
  const MIN_VOTERS = 1;
  const MAX_VOTERS = 99;
  const TAU = Math.PI * 2;
  const PALETTE = [
    "#e95742",
    "#238b82",
    "#e5a62f",
    "#665eb0",
    "#d56b37",
    "#3f7597",
    "#8b567f",
    "#437c4b"
  ];
  const VALID_SCREENS = new Set(["setup", "voting", "handover", "complete", "results"]);
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let optionSequence = 0;
  let selectedOptionId = null;
  let wheelSegments = [];
  let wheelRotation = 0;
  let spinSequence = 0;
  let pendingConfirmation = null;
  let toastTimer = null;
  let resizeTimer = null;
  let storageWorks = true;

  const elements = {
    views: {
      setup: document.querySelector("#setupView"),
      voting: document.querySelector("#votingView"),
      handover: document.querySelector("#handoverView"),
      complete: document.querySelector("#completeView"),
      results: document.querySelector("#resultsView")
    },
    steps: [...document.querySelectorAll("#progressSteps li")],
    setupForm: document.querySelector("#setupForm"),
    questionInput: document.querySelector("#questionInput"),
    questionCount: document.querySelector("#questionCount"),
    optionsList: document.querySelector("#optionsList"),
    optionCount: document.querySelector("#optionCount"),
    addOptionButton: document.querySelector("#addOptionButton"),
    voterCountInput: document.querySelector("#voterCountInput"),
    decreaseVoters: document.querySelector("#decreaseVoters"),
    increaseVoters: document.querySelector("#increaseVoters"),
    setupError: document.querySelector("#setupError"),
    draftStatus: document.querySelector("#draftStatus"),
    cancelVotingButton: document.querySelector("#cancelVotingButton"),
    voteCounter: document.querySelector("#voteCounter"),
    voteProgress: document.querySelector("#voteProgress"),
    voteProgressBar: document.querySelector("#voteProgressBar"),
    votingQuestion: document.querySelector("#votingQuestion"),
    answerGrid: document.querySelector("#answerGrid"),
    selectionHint: document.querySelector("#selectionHint"),
    submitVoteButton: document.querySelector("#submitVoteButton"),
    handoverText: document.querySelector("#handoverText"),
    handoverProgress: document.querySelector("#handoverProgress"),
    nextVoterButton: document.querySelector("#nextVoterButton"),
    completeCount: document.querySelector("#completeCount"),
    showResultsButton: document.querySelector("#showResultsButton"),
    resultQuestion: document.querySelector("#resultQuestion"),
    totalVoteCount: document.querySelector("#totalVoteCount"),
    resultList: document.querySelector("#resultList"),
    wheelCanvas: document.querySelector("#wheelCanvas"),
    spinButton: document.querySelector("#spinButton"),
    winnerBanner: document.querySelector("#winnerBanner"),
    winnerText: document.querySelector("#winnerText"),
    repeatVotingButton: document.querySelector("#repeatVotingButton"),
    editSetupButton: document.querySelector("#editSetupButton"),
    confirmDialog: document.querySelector("#confirmDialog"),
    dialogTitle: document.querySelector("#dialogTitle"),
    dialogText: document.querySelector("#dialogText"),
    dialogCancelButton: document.querySelector("#dialogCancelButton"),
    dialogConfirmButton: document.querySelector("#dialogConfirmButton"),
    toast: document.querySelector("#toast")
  };

  function createOption(text = "", colorIndex = 0) {
    optionSequence += 1;
    return {
      id: `option-${Date.now()}-${optionSequence}`,
      text,
      color: PALETTE[colorIndex % PALETTE.length],
      votes: 0
    };
  }

  function createInitialState() {
    return {
      version: 1,
      screen: "setup",
      question: "",
      voterTarget: 4,
      votesCast: 0,
      options: [createOption("", 0), createOption("", 1), createOption("", 2)]
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return createInitialState();

      const parsed = JSON.parse(saved);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.options)) {
        return createInitialState();
      }

      const options = parsed.options.slice(0, MAX_OPTIONS).map((option, index) => ({
        id: typeof option.id === "string" ? option.id : createOption("", index).id,
        text: typeof option.text === "string" ? option.text.slice(0, 70) : "",
        color: PALETTE.includes(option.color) ? option.color : PALETTE[index % PALETTE.length],
        votes: clamp(Number.parseInt(option.votes, 10) || 0, 0, MAX_VOTERS)
      }));

      while (options.length < MIN_OPTIONS) {
        options.push(createOption("", options.length));
      }

      const votesCast = options.reduce((total, option) => total + option.votes, 0);
      const voterTarget = clamp(
        Math.max(Number.parseInt(parsed.voterTarget, 10) || 4, votesCast),
        MIN_VOTERS,
        MAX_VOTERS
      );
      let screen = VALID_SCREENS.has(parsed.screen) ? parsed.screen : "setup";
      const configIsComplete =
        typeof parsed.question === "string" &&
        parsed.question.trim().length > 0 &&
        options.every((option) => option.text.trim().length > 0);

      if (!configIsComplete && screen !== "setup") screen = "setup";
      if (votesCast >= voterTarget && (screen === "voting" || screen === "handover")) screen = "complete";
      if (votesCast === 0 && (screen === "complete" || screen === "results")) screen = "setup";
      if (votesCast === 0 && screen === "handover") screen = "voting";

      return {
        version: 1,
        screen,
        question: typeof parsed.question === "string" ? parsed.question.slice(0, 120) : "",
        voterTarget,
        votesCast,
        options
      };
    } catch (error) {
      storageWorks = false;
      return createInitialState();
    }
  }

  let state = loadState();

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageWorks = true;
      updateStorageStatus();
    } catch (error) {
      storageWorks = false;
      updateStorageStatus();
    }
  }

  function updateStorageStatus() {
    if (!elements.draftStatus) return;
    if (storageWorks) {
      elements.draftStatus.lastChild.textContent = " Lokal gespeichert";
      elements.draftStatus.title = "Dein Entwurf wird in diesem Browser gespeichert.";
    } else {
      elements.draftStatus.lastChild.textContent = " Speichern nicht möglich";
      elements.draftStatus.title = "Der Browser hat den lokalen Speicher blockiert.";
    }
  }

  function screenStep(screen) {
    if (screen === "setup") return 1;
    if (screen === "results") return 3;
    return 2;
  }

  function renderStepIndicator() {
    const activeStep = screenStep(state.screen);
    elements.steps.forEach((stepElement, index) => {
      const step = index + 1;
      stepElement.classList.toggle("is-active", step === activeStep);
      stepElement.classList.toggle("is-complete", step < activeStep);
      if (step < activeStep) {
        stepElement.querySelector("span").textContent = "✓";
      } else {
        stepElement.querySelector("span").textContent = String(step);
      }
      stepElement.setAttribute("aria-current", step === activeStep ? "step" : "false");
    });
  }

  function renderApp({ scroll = true } = {}) {
    Object.entries(elements.views).forEach(([name, view]) => {
      view.hidden = name !== state.screen;
    });
    renderStepIndicator();

    switch (state.screen) {
      case "setup":
        renderSetup();
        break;
      case "voting":
        renderVoting();
        break;
      case "handover":
        renderHandover();
        break;
      case "complete":
        renderComplete();
        break;
      case "results":
        renderResults();
        break;
      default:
        state.screen = "setup";
        renderSetup();
    }

    if (scroll) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
    }
  }

  function setScreen(screen) {
    state.screen = screen;
    selectedOptionId = null;
    persistState();
    renderApp();
  }

  function renderSetup() {
    elements.questionInput.value = state.question;
    elements.questionCount.textContent = `${state.question.length} / 120`;
    elements.voterCountInput.value = String(state.voterTarget);
    clearSetupError();
    renderOptionRows();
    updateStorageStatus();
  }

  function renderOptionRows() {
    elements.optionsList.replaceChildren();
    state.options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "option-row";

      const number = document.createElement("span");
      number.className = "option-index";
      number.style.background = option.color;
      number.textContent = String(index + 1).padStart(2, "0");
      number.setAttribute("aria-hidden", "true");

      const label = document.createElement("label");
      label.htmlFor = `input-${option.id}`;
      label.hidden = true;
      label.textContent = `Antwortoption ${index + 1}`;

      const input = document.createElement("input");
      input.id = `input-${option.id}`;
      input.type = "text";
      input.maxLength = 70;
      input.autocomplete = "off";
      input.placeholder = `Antwortoption ${index + 1}`;
      input.value = option.text;
      input.dataset.optionId = option.id;
      input.setAttribute("aria-label", `Antwortoption ${index + 1}`);

      const removeButton = document.createElement("button");
      removeButton.className = "remove-option";
      removeButton.type = "button";
      removeButton.dataset.removeOption = option.id;
      removeButton.setAttribute("aria-label", `Antwortoption ${index + 1} entfernen`);
      removeButton.disabled = state.options.length <= MIN_OPTIONS;
      removeButton.textContent = "×";

      row.append(number, label, input, removeButton);
      elements.optionsList.append(row);
    });

    elements.optionCount.textContent = `${state.options.length} / ${MAX_OPTIONS}`;
    elements.addOptionButton.disabled = state.options.length >= MAX_OPTIONS;
  }

  function clearSetupError() {
    elements.setupError.hidden = true;
    elements.setupError.textContent = "";
    elements.questionInput.removeAttribute("aria-invalid");
    elements.voterCountInput.removeAttribute("aria-invalid");
    elements.optionsList.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
  }

  function showSetupError(message, target) {
    elements.setupError.textContent = message;
    elements.setupError.hidden = false;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.focus();
    }
  }

  function validateSetup() {
    clearSetupError();
    state.question = elements.questionInput.value.trim();
    const voterValue = Number.parseInt(elements.voterCountInput.value, 10);
    state.voterTarget = clamp(Number.isFinite(voterValue) ? voterValue : 0, MIN_VOTERS, MAX_VOTERS);
    elements.voterCountInput.value = String(state.voterTarget);

    elements.optionsList.querySelectorAll("input[data-option-id]").forEach((input) => {
      const option = state.options.find((item) => item.id === input.dataset.optionId);
      if (option) {
        option.text = input.value.trim();
        input.value = option.text;
      }
    });

    if (!state.question) {
      showSetupError("Bitte gib zuerst eine Abstimmungsfrage ein.", elements.questionInput);
      return false;
    }

    const emptyOptionIndex = state.options.findIndex((option) => !option.text);
    if (emptyOptionIndex >= 0) {
      const target = elements.optionsList.querySelector(`[data-option-id="${state.options[emptyOptionIndex].id}"]`);
      showSetupError(`Bitte fülle Antwortoption ${emptyOptionIndex + 1} aus.`, target);
      return false;
    }

    const normalizedOptions = state.options.map((option) => option.text.toLocaleLowerCase("de-DE"));
    const duplicateIndex = normalizedOptions.findIndex((text, index) => normalizedOptions.indexOf(text) !== index);
    if (duplicateIndex >= 0) {
      const target = elements.optionsList.querySelector(`[data-option-id="${state.options[duplicateIndex].id}"]`);
      showSetupError("Jede Antwortoption muss einen eigenen Namen haben.", target);
      return false;
    }

    if (voterValue < MIN_VOTERS || voterValue > MAX_VOTERS || !Number.isFinite(voterValue)) {
      showSetupError(`Bitte wähle zwischen ${MIN_VOTERS} und ${MAX_VOTERS} Personen.`, elements.voterCountInput);
      return false;
    }

    persistState();
    return true;
  }

  function renderVoting() {
    selectedOptionId = null;
    const currentVoter = state.votesCast + 1;
    elements.voteCounter.textContent = `Stimme ${currentVoter} von ${state.voterTarget}`;
    elements.voteProgress.setAttribute("aria-valuemax", String(state.voterTarget));
    elements.voteProgress.setAttribute("aria-valuenow", String(state.votesCast));
    elements.voteProgressBar.style.width = `${(state.votesCast / state.voterTarget) * 100}%`;
    elements.votingQuestion.textContent = state.question;
    elements.answerGrid.replaceChildren();

    state.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-button";
      button.dataset.optionId = option.id;
      button.style.setProperty("--option-color", option.color);
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");

      const swatch = document.createElement("span");
      swatch.className = "answer-swatch";
      swatch.textContent = String(index + 1).padStart(2, "0");
      swatch.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "answer-label";
      label.textContent = option.text;

      const check = document.createElement("span");
      check.className = "answer-check";
      check.textContent = "✓";
      check.setAttribute("aria-hidden", "true");

      button.append(swatch, label, check);
      elements.answerGrid.append(button);
    });

    elements.selectionHint.textContent = "Noch keine Antwort ausgewählt";
    elements.submitVoteButton.disabled = true;
  }

  function selectAnswer(optionId) {
    const option = state.options.find((item) => item.id === optionId);
    if (!option) return;
    selectedOptionId = optionId;
    elements.answerGrid.querySelectorAll(".answer-button").forEach((button) => {
      const selected = button.dataset.optionId === optionId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    elements.selectionHint.textContent = `Ausgewählt: ${option.text}`;
    elements.submitVoteButton.disabled = false;
  }

  function submitVote() {
    if (!selectedOptionId || state.votesCast >= state.voterTarget) return;
    const option = state.options.find((item) => item.id === selectedOptionId);
    if (!option) return;

    option.votes += 1;
    state.votesCast += 1;
    selectedOptionId = null;

    if (state.votesCast >= state.voterTarget) {
      setScreen("complete");
    } else {
      setScreen("handover");
    }
  }

  function renderHandover() {
    const remaining = state.voterTarget - state.votesCast;
    elements.handoverText.textContent = remaining === 1
      ? "Eine Person fehlt noch. Deine Auswahl ist auf diesem Bildschirm nicht sichtbar."
      : `Noch ${remaining} Personen fehlen. Deine Auswahl ist auf diesem Bildschirm nicht sichtbar.`;
    elements.handoverProgress.textContent = `${state.votesCast} von ${state.voterTarget} Stimmen abgegeben`;
  }

  function renderComplete() {
    const label = state.votesCast === 1 ? "Stimme wurde" : "Stimmen wurden";
    elements.completeCount.textContent = `${state.votesCast} ${label} lokal gespeichert`;
  }

  function percentage(value, total) {
    if (!total) return "0 %";
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format((value / total) * 100)} %`;
  }

  function renderResults() {
    elements.resultQuestion.textContent = state.question;
    elements.totalVoteCount.textContent = String(state.votesCast);
    elements.resultList.replaceChildren();

    [...state.options]
      .sort((first, second) => second.votes - first.votes)
      .forEach((option) => {
        const item = document.createElement("li");
        item.className = "result-item";
        item.style.setProperty("--option-color", option.color);

        const color = document.createElement("span");
        color.className = "result-color";
        color.setAttribute("aria-hidden", "true");

        const label = document.createElement("div");
        label.className = "result-label";
        const labelText = document.createElement("strong");
        labelText.textContent = option.text;
        const weight = document.createElement("span");
        weight.textContent = option.votes === 1 ? "Gewicht 1 Stimme" : `Gewicht ${option.votes} Stimmen`;
        label.append(labelText, weight);

        const numbers = document.createElement("div");
        numbers.className = "result-numbers";
        const count = document.createElement("strong");
        count.textContent = String(option.votes);
        const share = document.createElement("span");
        share.textContent = percentage(option.votes, state.votesCast);
        numbers.append(count, share);

        item.append(color, label, numbers);
        elements.resultList.append(item);
      });

    elements.winnerBanner.hidden = true;
    elements.winnerText.textContent = "";
    elements.spinButton.disabled = false;
    elements.spinButton.innerHTML = '<span aria-hidden="true">↻</span> Rad drehen';
    wheelRotation = 0;
    elements.wheelCanvas.style.transition = "none";
    elements.wheelCanvas.style.transform = "rotate(0deg)";
    window.requestAnimationFrame(drawWheel);
  }

  function normalizeRadians(angle) {
    return ((angle % TAU) + TAU) % TAU;
  }

  function normalizeDegrees(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function readableTextColor(hexColor) {
    const hex = hexColor.replace("#", "");
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    return luminance > 0.64 ? "#102a43" : "#ffffff";
  }

  function shortenLabel(text, maximumLength) {
    if (text.length <= maximumLength) return text;
    return `${text.slice(0, Math.max(maximumLength - 1, 1)).trim()}…`;
  }

  function drawWheel() {
    if (state.screen !== "results") return;
    const canvas = elements.wheelCanvas;
    const context = canvas.getContext("2d");
    const cssSize = Math.max(260, Math.round(canvas.getBoundingClientRect().width || 520));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssSize * pixelRatio);
    canvas.height = Math.round(cssSize * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssSize, cssSize);

    const center = cssSize / 2;
    const radius = center - 5;
    const weightedOptions = state.options.filter((option) => option.votes > 0);
    const totalWeight = weightedOptions.reduce((total, option) => total + option.votes, 0);
    let startAngle = -Math.PI / 2;
    wheelSegments = [];

    context.save();
    context.translate(center, center);

    weightedOptions.forEach((option) => {
      const arc = (option.votes / totalWeight) * TAU;
      const endAngle = startAngle + arc;
      wheelSegments.push({ option, start: startAngle, arc, end: endAngle });

      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius, startAngle, endAngle);
      context.closePath();
      context.fillStyle = option.color;
      context.fill();
      context.lineWidth = Math.max(2, cssSize * 0.006);
      context.strokeStyle = "rgba(255, 255, 255, 0.92)";
      context.stroke();

      if (arc >= 0.14) {
        const middle = startAngle + arc / 2;
        const normalizedMiddle = normalizeRadians(middle);
        const fontSize = clamp(Math.round(cssSize * Math.min(0.033, arc / 6)), 11, 17);
        const allowedCharacters = clamp(Math.round(arc * 13), 5, 22);

        context.save();
        context.rotate(middle);
        context.translate(radius * 0.63, 0);
        if (normalizedMiddle > Math.PI / 2 && normalizedMiddle < Math.PI * 1.5) {
          context.rotate(Math.PI);
        }
        context.fillStyle = readableTextColor(option.color);
        context.font = `800 ${fontSize}px Inter, Avenir, "Segoe UI", sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(shortenLabel(option.text, allowedCharacters), 0, 0, radius * 0.55);
        context.restore();
      }

      startAngle = endAngle;
    });

    context.beginPath();
    context.arc(0, 0, radius, 0, TAU);
    context.lineWidth = Math.max(3, cssSize * 0.009);
    context.strokeStyle = "rgba(16, 42, 67, 0.2)";
    context.stroke();
    context.restore();

    canvas.setAttribute(
      "aria-label",
      `Gewichtetes Glücksrad: ${state.options.map((option) => `${option.text}, ${option.votes} ${option.votes === 1 ? "Stimme" : "Stimmen"}`).join("; ")}`
    );
  }

  function secureRandom() {
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] / 4294967296;
    }
    return Math.random();
  }

  function weightedRandomOption() {
    const threshold = Math.floor(secureRandom() * state.votesCast);
    let runningWeight = 0;
    for (const option of state.options) {
      runningWeight += option.votes;
      if (threshold < runningWeight) return option;
    }
    return state.options.find((option) => option.votes > 0);
  }

  function spinWheel() {
    if (!wheelSegments.length || elements.spinButton.disabled) return;
    const selectedOption = weightedRandomOption();
    const selectedSegment = wheelSegments.find((segment) => segment.option.id === selectedOption.id);
    if (!selectedSegment) return;

    spinSequence += 1;
    const currentSpin = spinSequence;
    elements.winnerBanner.hidden = true;
    elements.spinButton.disabled = true;
    elements.spinButton.textContent = "Rad dreht sich …";

    const segmentMiddleDegrees = (selectedSegment.start + selectedSegment.arc / 2) * (180 / Math.PI);
    const desiredRotation = normalizeDegrees(-90 - segmentMiddleDegrees);
    const currentRotation = normalizeDegrees(wheelRotation);
    const alignment = normalizeDegrees(desiredRotation - currentRotation);
    const fullTurns = 5 + Math.floor(secureRandom() * 3);
    wheelRotation += fullTurns * 360 + alignment;

    const duration = prefersReducedMotion.matches ? 60 : 4700;
    const canvas = elements.wheelCanvas;
    canvas.style.transition = "none";
    canvas.style.transform = `rotate(${currentRotation}deg)`;
    void canvas.offsetWidth;
    canvas.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.62, 0.1, 1)`;

    let completed = false;
    const finishSpin = () => {
      if (completed || currentSpin !== spinSequence) return;
      completed = true;
      canvas.style.transition = "none";
      canvas.style.transform = `rotate(${normalizeDegrees(wheelRotation)}deg)`;
      wheelRotation = normalizeDegrees(wheelRotation);
      elements.winnerText.textContent = selectedOption.text;
      elements.winnerBanner.hidden = false;
      elements.spinButton.disabled = false;
      elements.spinButton.innerHTML = '<span aria-hidden="true">↻</span> Noch einmal drehen';
    };

    canvas.addEventListener("transitionend", finishSpin, { once: true });
    window.requestAnimationFrame(() => {
      canvas.style.transform = `rotate(${wheelRotation}deg)`;
    });
    window.setTimeout(finishSpin, duration + 180);
  }

  function resetVotes() {
    state.options.forEach((option) => {
      option.votes = 0;
    });
    state.votesCast = 0;
  }

  function requestConfirmation({ title, text, confirmLabel = "Fortfahren" }, onConfirm) {
    if (typeof elements.confirmDialog.showModal !== "function") {
      if (window.confirm(`${title}\n\n${text}`)) onConfirm();
      return;
    }
    pendingConfirmation = onConfirm;
    elements.dialogTitle.textContent = title;
    elements.dialogText.textContent = text;
    elements.dialogConfirmButton.textContent = confirmLabel;
    elements.confirmDialog.showModal();
  }

  function closeConfirmation() {
    pendingConfirmation = null;
    if (elements.confirmDialog.open) elements.confirmDialog.close();
  }

  function confirmPendingAction() {
    const action = pendingConfirmation;
    closeConfirmation();
    if (typeof action === "function") action();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 2800);
  }

  function adjustVoterCount(change) {
    const current = Number.parseInt(elements.voterCountInput.value, 10) || state.voterTarget;
    state.voterTarget = clamp(current + change, MIN_VOTERS, MAX_VOTERS);
    elements.voterCountInput.value = String(state.voterTarget);
    persistState();
  }

  elements.questionInput.addEventListener("input", () => {
    state.question = elements.questionInput.value;
    elements.questionCount.textContent = `${state.question.length} / 120`;
    elements.questionInput.removeAttribute("aria-invalid");
    elements.setupError.hidden = true;
    persistState();
  });

  elements.optionsList.addEventListener("input", (event) => {
    const input = event.target.closest("input[data-option-id]");
    if (!input) return;
    const option = state.options.find((item) => item.id === input.dataset.optionId);
    if (option) option.text = input.value;
    input.removeAttribute("aria-invalid");
    elements.setupError.hidden = true;
    persistState();
  });

  elements.optionsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-remove-option]");
    if (!button || state.options.length <= MIN_OPTIONS) return;
    const optionIndex = state.options.findIndex((option) => option.id === button.dataset.removeOption);
    if (optionIndex < 0) return;
    state.options.splice(optionIndex, 1);
    state.options.forEach((option, index) => {
      option.color = PALETTE[index];
    });
    persistState();
    renderOptionRows();
  });

  elements.addOptionButton.addEventListener("click", () => {
    if (state.options.length >= MAX_OPTIONS) return;
    const option = createOption("", state.options.length);
    state.options.push(option);
    persistState();
    renderOptionRows();
    const input = elements.optionsList.querySelector(`[data-option-id="${option.id}"]`);
    if (input) input.focus();
  });

  elements.voterCountInput.addEventListener("input", () => {
    const value = Number.parseInt(elements.voterCountInput.value, 10);
    if (Number.isFinite(value)) state.voterTarget = clamp(value, MIN_VOTERS, MAX_VOTERS);
    elements.voterCountInput.removeAttribute("aria-invalid");
    elements.setupError.hidden = true;
    persistState();
  });

  elements.voterCountInput.addEventListener("change", () => {
    const value = Number.parseInt(elements.voterCountInput.value, 10);
    state.voterTarget = clamp(Number.isFinite(value) ? value : 4, MIN_VOTERS, MAX_VOTERS);
    elements.voterCountInput.value = String(state.voterTarget);
    persistState();
  });

  elements.decreaseVoters.addEventListener("click", () => adjustVoterCount(-1));
  elements.increaseVoters.addEventListener("click", () => adjustVoterCount(1));

  elements.setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validateSetup()) return;
    resetVotes();
    setScreen("voting");
    showToast("Abstimmung gestartet – gib das Gerät an Person 1.");
  });

  elements.answerGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-option-id]");
    if (button) selectAnswer(button.dataset.optionId);
  });

  elements.submitVoteButton.addEventListener("click", submitVote);
  elements.nextVoterButton.addEventListener("click", () => setScreen("voting"));
  elements.showResultsButton.addEventListener("click", () => setScreen("results"));
  elements.spinButton.addEventListener("click", spinWheel);

  elements.cancelVotingButton.addEventListener("click", () => {
    const existingVotes = state.votesCast;
    requestConfirmation(
      {
        title: "Abstimmung abbrechen?",
        text: existingVotes
          ? `Die bisher abgegebenen ${existingVotes} ${existingVotes === 1 ? "Stimme wird" : "Stimmen werden"} gelöscht. Das Setup bleibt erhalten.`
          : "Du kehrst zum Setup zurück. Frage und Optionen bleiben erhalten.",
        confirmLabel: "Abstimmung abbrechen"
      },
      () => {
        resetVotes();
        setScreen("setup");
      }
    );
  });

  elements.repeatVotingButton.addEventListener("click", () => {
    requestConfirmation(
      {
        title: "Neue Abstimmungsrunde starten?",
        text: "Die aktuelle Auswertung wird gelöscht. Frage, Optionen und Personenzahl bleiben gleich.",
        confirmLabel: "Neue Runde starten"
      },
      () => {
        resetVotes();
        setScreen("voting");
        showToast("Neue Runde gestartet.");
      }
    );
  });

  elements.editSetupButton.addEventListener("click", () => {
    requestConfirmation(
      {
        title: "Setup bearbeiten?",
        text: "Beim Bearbeiten wird die aktuelle Auswertung gelöscht. Frage und Optionen bleiben als Entwurf erhalten.",
        confirmLabel: "Setup bearbeiten"
      },
      () => {
        resetVotes();
        setScreen("setup");
      }
    );
  });

  elements.dialogCancelButton.addEventListener("click", closeConfirmation);
  elements.dialogConfirmButton.addEventListener("click", confirmPendingAction);
  elements.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirmation();
  });
  elements.confirmDialog.addEventListener("click", (event) => {
    if (event.target === elements.confirmDialog) closeConfirmation();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.screen === "results" && !elements.spinButton.disabled) drawWheel();
    }, 120);
  });

  renderApp({ scroll: false });
})();
