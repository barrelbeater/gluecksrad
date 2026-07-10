(() => {
  "use strict";

  const STORAGE_KEY = "stimmrad-state-v1";
  const ONLINE_SESSION_KEY = "stimmrad-online-session-v1";
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
  let selectedSetupMode = "local";
  let supabaseClient = null;
  let authUser = null;
  let onlineChannel = null;
  let onlinePollingTimer = null;
  let onlineBusy = false;
  let authPromise = null;
  let pendingParticipantSpin = null;
  let participantSpinInProgress = false;

  const elements = {
    views: {
      setup: document.querySelector("#setupView"),
      voting: document.querySelector("#votingView"),
      handover: document.querySelector("#handoverView"),
      complete: document.querySelector("#completeView"),
      results: document.querySelector("#resultsView"),
      onlineJoin: document.querySelector("#onlineJoinView"),
      onlineHost: document.querySelector("#onlineHostView"),
      onlineThanks: document.querySelector("#onlineThanksView")
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
    localModeButton: document.querySelector("#localModeButton"),
    onlineModeButton: document.querySelector("#onlineModeButton"),
    localVoterField: document.querySelector("#localVoterField"),
    setupSubmitButton: document.querySelector("#setupSubmitButton"),
    setupSubmitLabel: document.querySelector("#setupSubmitLabel"),
    privacyNoteText: document.querySelector("#privacyNoteText"),
    quickJoinForm: document.querySelector("#quickJoinForm"),
    quickJoinCode: document.querySelector("#quickJoinCode"),
    onlineJoinForm: document.querySelector("#onlineJoinForm"),
    onlineJoinCode: document.querySelector("#onlineJoinCode"),
    onlineJoinButton: document.querySelector("#onlineJoinButton"),
    onlineJoinError: document.querySelector("#onlineJoinError"),
    onlineHomeButtons: [...document.querySelectorAll(".online-home-button")],
    onlineHostQuestion: document.querySelector("#onlineHostQuestion"),
    hostVoteCount: document.querySelector("#hostVoteCount"),
    hostRoomCode: document.querySelector("#hostRoomCode"),
    hostShareLink: document.querySelector("#hostShareLink"),
    hostOptionList: document.querySelector("#hostOptionList"),
    hostEmptyVotes: document.querySelector("#hostEmptyVotes"),
    hostConnectionLabel: document.querySelector("#hostConnectionLabel"),
    hostActionStatus: document.querySelector("#hostActionStatus"),
    copyJoinLinkButton: document.querySelector("#copyJoinLinkButton"),
    closeOnlinePollButton: document.querySelector("#closeOnlinePollButton"),
    leaveOnlineHostButton: document.querySelector("#leaveOnlineHostButton"),
    participantRoomCode: document.querySelector("#participantRoomCode"),
    participantConnectionLabel: document.querySelector("#participantConnectionLabel"),
    leaveOnlineParticipantButton: document.querySelector("#leaveOnlineParticipantButton"),
    cancelVotingButton: document.querySelector("#cancelVotingButton"),
    cancelVotingLabel: document.querySelector("#cancelVotingLabel"),
    voteCounter: document.querySelector("#voteCounter"),
    voteProgress: document.querySelector("#voteProgress"),
    voteProgressBar: document.querySelector("#voteProgressBar"),
    votingQuestion: document.querySelector("#votingQuestion"),
    votingEyebrow: document.querySelector("#votingEyebrow"),
    votingLead: document.querySelector("#votingLead"),
    answerGrid: document.querySelector("#answerGrid"),
    selectionHint: document.querySelector("#selectionHint"),
    submitVoteButton: document.querySelector("#submitVoteButton"),
    handoverText: document.querySelector("#handoverText"),
    handoverProgress: document.querySelector("#handoverProgress"),
    nextVoterButton: document.querySelector("#nextVoterButton"),
    completeCount: document.querySelector("#completeCount"),
    showResultsButton: document.querySelector("#showResultsButton"),
    resultQuestion: document.querySelector("#resultQuestion"),
    resultEyebrow: document.querySelector("#resultEyebrow"),
    resultLead: document.querySelector("#resultLead"),
    totalVoteCount: document.querySelector("#totalVoteCount"),
    resultList: document.querySelector("#resultList"),
    wheelCanvas: document.querySelector("#wheelCanvas"),
    spinButton: document.querySelector("#spinButton"),
    winnerBanner: document.querySelector("#winnerBanner"),
    winnerText: document.querySelector("#winnerText"),
    participantWheelNote: document.querySelector("#participantWheelNote"),
    repeatVotingButton: document.querySelector("#repeatVotingButton"),
    editSetupButton: document.querySelector("#editSetupButton"),
    confirmDialog: document.querySelector("#confirmDialog"),
    dialogTitle: document.querySelector("#dialogTitle"),
    dialogText: document.querySelector("#dialogText"),
    dialogCancelButton: document.querySelector("#dialogCancelButton"),
    dialogConfirmButton: document.querySelector("#dialogConfirmButton"),
    toast: document.querySelector("#toast"),
    footerStatus: document.querySelector("#footerStatus")
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
      mode: "local",
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
        mode: "local",
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
    if (state.mode === "online") {
      persistOnlineSession();
      return;
    }
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
    if (screen === "setup" || screen === "onlineJoin") return 1;
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
    if (state.mode !== "online") {
      elements.footerStatus.textContent = "Lokal oder online · Ohne persönliche Daten";
    }

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
      case "onlineJoin":
        renderOnlineJoin();
        break;
      case "onlineHost":
        renderOnlineHost();
        break;
      case "onlineThanks":
        renderOnlineThanks();
        break;
      default:
        state = loadState();
        elements.views.setup.hidden = false;
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
    updateSetupMode();
  }

  function setSetupMode(mode) {
    selectedSetupMode = mode === "online" ? "online" : "local";
    updateSetupMode();
  }

  function updateSetupMode() {
    const isOnline = selectedSetupMode === "online";
    elements.localModeButton.classList.toggle("is-active", !isOnline);
    elements.onlineModeButton.classList.toggle("is-active", isOnline);
    elements.localModeButton.setAttribute("aria-pressed", String(!isOnline));
    elements.onlineModeButton.setAttribute("aria-pressed", String(isOnline));
    elements.localVoterField.hidden = isOnline;
    elements.setupSubmitLabel.textContent = isOnline ? "Online-Abstimmung erstellen" : "Abstimmung starten";
    elements.privacyNoteText.innerHTML = isOnline
      ? "<strong>Live über Supabase</strong>Stimmen werden anonym und geschützt online gespeichert."
      : "<strong>100 % lokal</strong>Keine Stimme verlässt dieses Gerät.";
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

    if (selectedSetupMode === "local" && (voterValue < MIN_VOTERS || voterValue > MAX_VOTERS || !Number.isFinite(voterValue))) {
      showSetupError(`Bitte wähle zwischen ${MIN_VOTERS} und ${MAX_VOTERS} Personen.`, elements.voterCountInput);
      return false;
    }

    persistState();
    return true;
  }

  function renderVoting() {
    selectedOptionId = null;
    const isOnline = state.mode === "online";
    if (isOnline) {
      elements.voteCounter.textContent = `Online · Raum ${state.online.code}`;
      elements.voteProgress.hidden = true;
      elements.cancelVotingLabel.textContent = "Raum verlassen";
      elements.votingEyebrow.textContent = "Online und anonym abstimmen";
      elements.votingLead.textContent = "Wähle genau eine Antwort. Nach dem Absenden kann die Stimme nicht geändert werden.";
    } else {
      const currentVoter = state.votesCast + 1;
      elements.voteCounter.textContent = `Stimme ${currentVoter} von ${state.voterTarget}`;
      elements.voteProgress.hidden = false;
      elements.voteProgress.setAttribute("aria-valuemax", String(state.voterTarget));
      elements.voteProgress.setAttribute("aria-valuenow", String(state.votesCast));
      elements.voteProgressBar.style.width = `${(state.votesCast / state.voterTarget) * 100}%`;
      elements.cancelVotingLabel.textContent = "Abstimmung abbrechen";
      elements.votingEyebrow.textContent = "Deine Stimme bleibt geheim";
      elements.votingLead.textContent = "Wähle genau eine Antwort und bestätige deine Auswahl.";
    }
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
    elements.submitVoteButton.innerHTML = 'Stimme verbindlich abgeben <span aria-hidden="true">→</span>';
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

  async function submitVote() {
    if (!selectedOptionId) return;
    if (state.mode === "online") {
      await castOnlineVote(selectedOptionId);
      return;
    }
    if (state.votesCast >= state.voterTarget) return;
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
    const isOnline = state.mode === "online";
    const isOnlineParticipant = isOnline && state.role === "participant";
    const hasPendingParticipantSpin = isOnlineParticipant && (pendingParticipantSpin || participantSpinInProgress);
    elements.resultQuestion.textContent = state.question;
    elements.totalVoteCount.textContent = String(state.votesCast);
    elements.resultEyebrow.textContent = isOnline ? "Online-Abstimmung beendet" : "Das Ergebnis steht fest";
    elements.resultLead.textContent = isOnline
      ? `Raum ${state.online.code} · Die Stimmen aller Geräte sind zusammengeführt.`
      : "Die Größe jedes Feldes entspricht seinem Stimmenanteil.";
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
    elements.spinButton.hidden = isOnlineParticipant;
    elements.participantWheelNote.hidden = !isOnlineParticipant;
    elements.spinButton.disabled = isOnlineParticipant;
    elements.spinButton.innerHTML = '<span aria-hidden="true">↻</span> Rad drehen';
    elements.repeatVotingButton.hidden = isOnlineParticipant;
    elements.repeatVotingButton.innerHTML = isOnline
      ? '<span aria-hidden="true">＋</span> Neue Online-Abstimmung'
      : '<span aria-hidden="true">↻</span> Noch einmal abstimmen';
    elements.editSetupButton.innerHTML = isOnlineParticipant
      ? '<span aria-hidden="true">←</span> Zur Startseite'
      : '<span aria-hidden="true">✎</span> Setup bearbeiten';

    if (isOnline && state.online.winnerOptionId && !hasPendingParticipantSpin) {
      const winner = state.options.find((option) => option.id === state.online.winnerOptionId);
      if (winner) {
        elements.winnerText.textContent = winner.text;
        elements.winnerBanner.hidden = false;
        elements.participantWheelNote.hidden = true;
      }
    }
    wheelRotation = 0;
    elements.wheelCanvas.style.transition = "none";
    elements.wheelCanvas.style.transform = "rotate(0deg)";
    window.requestAnimationFrame(() => {
      drawWheel();
      if (participantSpinInProgress) {
        return;
      }
      if (pendingParticipantSpin) {
        const pending = pendingParticipantSpin;
        pendingParticipantSpin = null;
        animateParticipantWinner(pending.optionId);
      } else if (isOnline && state.online.winnerOptionId) {
        positionWheelAtOption(state.online.winnerOptionId);
      }
    });
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

  function targetRotationForOption(optionId) {
    const segment = wheelSegments.find((item) => item.option.id === optionId);
    if (!segment) return null;
    const middleDegrees = (segment.start + segment.arc / 2) * (180 / Math.PI);
    return normalizeDegrees(-90 - middleDegrees);
  }

  function positionWheelAtOption(optionId) {
    const targetRotation = targetRotationForOption(optionId);
    if (targetRotation === null) return false;
    wheelRotation = targetRotation;
    elements.wheelCanvas.style.transition = "none";
    elements.wheelCanvas.style.transform = `rotate(${targetRotation}deg)`;
    return true;
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
    const desiredRotation = targetRotationForOption(selectedOption.id);
    if (desiredRotation === null) return;

    spinSequence += 1;
    const currentSpin = spinSequence;
    elements.winnerBanner.hidden = true;
    elements.spinButton.disabled = true;
    elements.spinButton.textContent = "Rad dreht sich …";

    if (state.mode === "online" && state.role === "host") {
      const nextSpinVersion = (state.online.spinVersion || 0) + 1;
      state.online.winnerOptionId = selectedOption.id;
      state.online.spinVersion = nextSpinVersion;
      saveOnlineWinner(selectedOption.id, nextSpinVersion);
    }

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

  function persistOnlineSession() {
    try {
      if (state.mode === "online" && state.online?.pollId) {
        localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify({
          pollId: state.online.pollId,
          code: state.online.code,
          role: state.role
        }));
      }
    } catch (error) {
      // Die Online-Abstimmung funktioniert auch ohne Wiederherstellung nach Reload.
    }
  }

  function normalizeRoomCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z2-9]/g, "")
      .slice(0, 6);
  }

  function createOnlineState(poll, options, role, screen) {
    return {
      version: 1,
      mode: "online",
      role,
      screen,
      question: poll.question,
      voterTarget: 1,
      votesCast: 0,
      options: options.map((option) => ({
        id: option.id,
        text: option.label,
        color: option.color,
        votes: 0
      })),
      online: {
        pollId: poll.id,
        code: poll.code,
        status: poll.status,
        winnerOptionId: poll.winner_option_id || null,
        spinVersion: Number.parseInt(poll.spin_version, 10) || 0
      }
    };
  }

  function initializeSupabase() {
    if (supabaseClient) return true;
    const config = window.STIMMRAD_CONFIG;
    if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
      return false;
    }
    supabaseClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      { auth: { persistSession: true, autoRefreshToken: true } }
    );
    return true;
  }

  async function ensureAnonymousUser() {
    if (authUser) return authUser;
    if (!initializeSupabase()) {
      throw new Error("Die Online-Bibliothek konnte nicht geladen werden. Prüfe die Internetverbindung.");
    }
    if (authPromise) return authPromise;

    authPromise = (async () => {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user) {
        authUser = sessionData.session.user;
        return authUser;
      }

      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) throw error;
      authUser = data.user;
      return authUser;
    })();

    try {
      return await authPromise;
    } finally {
      authPromise = null;
    }
  }

  function onlineErrorMessage(error) {
    const message = String(error?.message || error || "Unbekannter Fehler");
    if (error?.code === "PGRST205" || /polls.*schema cache|relation.*polls.*does not exist/i.test(message)) {
      return "Die Supabase-Tabellen fehlen noch. Führe zuerst supabase/schema.sql im SQL Editor aus.";
    }
    if (/anonymous sign.?ins.*disabled|anonymous provider is disabled/i.test(message)) {
      return "Anonyme Anmeldungen sind in Supabase noch nicht aktiviert.";
    }
    if (/failed to fetch|network|load failed/i.test(message)) {
      return "Supabase ist gerade nicht erreichbar. Prüfe die Internetverbindung und versuche es erneut.";
    }
    if (error?.code === "23505") {
      return "Diese Aktion wurde bereits ausgeführt.";
    }
    return message;
  }

  function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(secureRandom() * alphabet.length)];
    }
    return code;
  }

  function buildJoinLink(code) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("join", code);
    return url.toString();
  }

  function updateUrlCode(code = "") {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (code) url.searchParams.set("join", code);
    window.history.replaceState({}, "", url);
  }

  function openOnlineJoin(code = "") {
    cleanupOnlineConnection();
    try {
      localStorage.removeItem(ONLINE_SESSION_KEY);
    } catch (error) {
      // Kein Problem, falls lokaler Speicher blockiert ist.
    }
    state = {
      version: 1,
      mode: "online",
      role: "participant",
      screen: "onlineJoin",
      question: "",
      voterTarget: 1,
      votesCast: 0,
      options: [],
      online: { pollId: null, code: normalizeRoomCode(code), status: "open", winnerOptionId: null, spinVersion: 0 }
    };
    renderApp();
  }

  function returnToLocalSetup(preferOnline = false) {
    cleanupOnlineConnection();
    pendingParticipantSpin = null;
    participantSpinInProgress = false;
    try {
      localStorage.removeItem(ONLINE_SESSION_KEY);
    } catch (error) {
      // Kein Problem, falls lokaler Speicher blockiert ist.
    }
    updateUrlCode();
    state = loadState();
    state.screen = "setup";
    selectedSetupMode = preferOnline ? "online" : "local";
    renderApp();
  }

  function renderOnlineJoin() {
    elements.onlineJoinCode.value = state.online?.code || "";
    elements.onlineJoinError.hidden = true;
    elements.onlineJoinError.textContent = "";
    elements.onlineJoinButton.disabled = false;
    elements.onlineJoinButton.innerHTML = 'Abstimmung beitreten <span aria-hidden="true">→</span>';
    elements.footerStatus.textContent = "Online-Modus · Anonym über Supabase";
    window.setTimeout(() => elements.onlineJoinCode.focus(), 50);
  }

  function renderOnlineHost() {
    elements.onlineHostQuestion.textContent = state.question;
    elements.hostRoomCode.textContent = state.online.code;
    elements.hostShareLink.textContent = buildJoinLink(state.online.code);
    elements.hostVoteCount.textContent = String(state.votesCast);
    elements.hostEmptyVotes.hidden = state.votesCast > 0;
    elements.closeOnlinePollButton.disabled = state.votesCast === 0 || onlineBusy;
    elements.hostActionStatus.textContent = state.votesCast === 0
      ? "Mindestens eine Stimme wird für das Glücksrad benötigt."
      : `${state.votesCast} ${state.votesCast === 1 ? "Stimme ist" : "Stimmen sind"} sicher gespeichert.`;
    elements.footerStatus.textContent = `Online-Raum ${state.online.code} · Live verbunden`;
    renderHostOptions();
  }

  function renderHostOptions() {
    elements.hostOptionList.replaceChildren();
    state.options.forEach((option) => {
      const item = document.createElement("li");
      item.className = "host-option-row";
      item.style.setProperty("--option-color", option.color);

      const color = document.createElement("span");
      color.className = "host-option-color";
      color.setAttribute("aria-hidden", "true");

      const main = document.createElement("div");
      main.className = "host-option-main";
      const label = document.createElement("div");
      label.className = "host-option-label";
      const name = document.createElement("strong");
      name.textContent = option.text;
      const percentageLabel = document.createElement("span");
      percentageLabel.textContent = percentage(option.votes, state.votesCast);
      label.append(name, percentageLabel);
      const bar = document.createElement("div");
      bar.className = "host-option-bar";
      const fill = document.createElement("span");
      fill.style.width = state.votesCast ? `${(option.votes / state.votesCast) * 100}%` : "0%";
      bar.append(fill);
      main.append(label, bar);

      const count = document.createElement("strong");
      count.className = "host-option-count";
      count.textContent = String(option.votes);
      item.append(color, main, count);
      elements.hostOptionList.append(item);
    });
  }

  function renderOnlineThanks() {
    elements.participantRoomCode.textContent = state.online.code;
    elements.participantConnectionLabel.textContent = state.online.status === "closed"
      ? "Ergebnis wird geladen …"
      : "Warte auf die Moderation …";
    elements.footerStatus.textContent = `Online-Raum ${state.online.code} · Stimme gespeichert`;
  }

  async function createOnlinePoll() {
    if (onlineBusy) return;
    onlineBusy = true;
    elements.setupSubmitButton.disabled = true;
    elements.setupSubmitLabel.textContent = "Online-Raum wird erstellt …";

    const draft = {
      question: state.question,
      options: state.options.map((option) => ({ text: option.text, color: option.color }))
    };

    try {
      const user = await ensureAnonymousUser();
      let poll = null;
      let lastError = null;

      for (let attempt = 0; attempt < 5 && !poll; attempt += 1) {
        const { data, error } = await supabaseClient
          .from("polls")
          .insert({ code: generateRoomCode(), question: draft.question, host_id: user.id })
          .select("id, code, question, status, host_id, winner_option_id, spin_version")
          .single();
        if (!error) poll = data;
        else if (error.code === "23505") lastError = error;
        else throw error;
      }
      if (!poll) throw lastError || new Error("Es konnte kein freier Raumcode erzeugt werden.");

      const optionRows = draft.options.map((option, index) => ({
        poll_id: poll.id,
        label: option.text,
        color: option.color,
        position: index
      }));
      const { data: savedOptions, error: optionError } = await supabaseClient
        .from("poll_options")
        .insert(optionRows)
        .select("id, poll_id, label, color, position")
        .order("position");

      if (optionError) {
        await supabaseClient.from("polls").delete().eq("id", poll.id);
        throw optionError;
      }

      state = createOnlineState(poll, savedOptions, "host", "onlineHost");
      updateUrlCode(poll.code);
      setScreen("onlineHost");
      subscribeOnline();
      await refreshHostVotes();
      showToast(`Online-Raum ${poll.code} wurde erstellt.`);
    } catch (error) {
      state = loadState();
      state.screen = "setup";
      selectedSetupMode = "online";
      renderApp({ scroll: false });
      showSetupError(onlineErrorMessage(error));
      elements.setupSubmitButton.focus();
    } finally {
      onlineBusy = false;
      elements.setupSubmitButton.disabled = false;
      if (state.screen === "setup") elements.setupSubmitLabel.textContent = "Online-Abstimmung erstellen";
      if (state.screen === "onlineHost") renderOnlineHost();
    }
  }

  async function joinOnlinePoll(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (code.length !== 6) {
      elements.onlineJoinError.textContent = "Bitte gib einen vollständigen sechsstelligen Code ein.";
      elements.onlineJoinError.hidden = false;
      elements.onlineJoinCode.focus();
      return false;
    }
    if (onlineBusy) return false;
    onlineBusy = true;
    elements.onlineJoinError.hidden = true;
    elements.onlineJoinButton.disabled = true;
    elements.onlineJoinButton.textContent = "Raum wird gesucht …";

    try {
      const user = await ensureAnonymousUser();
      const { data: poll, error: pollError } = await supabaseClient
        .from("polls")
        .select("id, code, question, status, host_id, winner_option_id, spin_version")
        .eq("code", code)
        .maybeSingle();
      if (pollError) throw pollError;
      if (!poll) throw new Error("Unter diesem Code wurde keine Abstimmung gefunden.");

      const { data: options, error: optionsError } = await supabaseClient
        .from("poll_options")
        .select("id, poll_id, label, color, position")
        .eq("poll_id", poll.id)
        .order("position");
      if (optionsError) throw optionsError;
      if (!options || options.length < MIN_OPTIONS) throw new Error("Die Antwortoptionen dieses Raums sind unvollständig.");

      const role = poll.host_id === user.id ? "host" : "participant";
      let screen = role === "host" ? "onlineHost" : "voting";

      if (role === "participant" && poll.status === "open") {
        const { data: existingVote, error: voteError } = await supabaseClient
          .from("votes")
          .select("id")
          .eq("poll_id", poll.id)
          .eq("voter_id", user.id)
          .maybeSingle();
        if (voteError) throw voteError;
        if (existingVote) screen = "onlineThanks";
      }

      state = createOnlineState(poll, options, role, screen);
      updateUrlCode(code);
      persistOnlineSession();

      if (poll.status === "closed") {
        await loadOnlineResults();
      } else {
        renderApp();
        subscribeOnline();
        if (role === "host") await refreshHostVotes();
      }
      return true;
    } catch (error) {
      elements.onlineJoinError.textContent = onlineErrorMessage(error);
      elements.onlineJoinError.hidden = false;
      return false;
    } finally {
      onlineBusy = false;
      elements.onlineJoinButton.disabled = false;
      if (state.screen === "onlineJoin") {
        elements.onlineJoinButton.innerHTML = 'Abstimmung beitreten <span aria-hidden="true">→</span>';
      }
      if (state.screen === "onlineHost") renderOnlineHost();
    }
  }

  function applyVoteRows(rows) {
    const counts = new Map();
    (rows || []).forEach((vote) => counts.set(vote.option_id, (counts.get(vote.option_id) || 0) + 1));
    state.options.forEach((option) => {
      option.votes = counts.get(option.id) || 0;
    });
    state.votesCast = (rows || []).length;
  }

  async function refreshHostVotes() {
    if (state.mode !== "online" || state.role !== "host" || !state.online.pollId) return;
    const pollId = state.online.pollId;
    const { data, error } = await supabaseClient
      .from("votes")
      .select("option_id")
      .eq("poll_id", pollId);
    if (error || state.online?.pollId !== pollId) {
      if (error) elements.hostConnectionLabel.textContent = "Verbindung prüfen";
      return;
    }
    applyVoteRows(data);
    elements.hostConnectionLabel.textContent = "Aktuell";
    if (state.screen === "onlineHost") renderOnlineHost();
  }

  async function castOnlineVote(optionId) {
    if (onlineBusy || state.online.status !== "open") return;
    onlineBusy = true;
    elements.submitVoteButton.disabled = true;
    elements.submitVoteButton.textContent = "Stimme wird gespeichert …";
    try {
      const user = await ensureAnonymousUser();
      const { error } = await supabaseClient.from("votes").insert({
        poll_id: state.online.pollId,
        option_id: optionId,
        voter_id: user.id
      });
      if (error) throw error;
      state.votesCast = 1;
      setScreen("onlineThanks");
      subscribeOnline();
    } catch (error) {
      const message = error?.code === "23505"
        ? "Auf diesem Gerät wurde bereits abgestimmt."
        : onlineErrorMessage(error);
      showToast(message);
      elements.submitVoteButton.disabled = false;
      elements.submitVoteButton.innerHTML = 'Stimme verbindlich abgeben <span aria-hidden="true">→</span>';
    } finally {
      onlineBusy = false;
    }
  }

  async function closeOnlinePoll() {
    if (onlineBusy || state.role !== "host" || state.votesCast < 1) return;
    onlineBusy = true;
    elements.closeOnlinePollButton.disabled = true;
    elements.closeOnlinePollButton.textContent = "Auswertung wird vorbereitet …";
    try {
      const { data: poll, error } = await supabaseClient
        .from("polls")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", state.online.pollId)
        .select("id, code, question, status, host_id, winner_option_id, spin_version")
        .single();
      if (error) throw error;
      state.online.status = poll.status;
      await loadOnlineResults();
    } catch (error) {
      elements.hostActionStatus.textContent = onlineErrorMessage(error);
      elements.closeOnlinePollButton.disabled = false;
      elements.closeOnlinePollButton.innerHTML = 'Abstimmung beenden &amp; Glücksrad öffnen <span aria-hidden="true">→</span>';
    } finally {
      onlineBusy = false;
    }
  }

  async function loadOnlineResults() {
    const pollId = state.online.pollId;
    const { data, error } = await supabaseClient
      .from("votes")
      .select("option_id")
      .eq("poll_id", pollId);
    if (error) throw error;
    if (state.mode !== "online" || state.online?.pollId !== pollId) return;
    applyVoteRows(data);
    state.online.status = "closed";
    setScreen("results");
    if (state.role === "participant") subscribeOnline();
    else cleanupOnlineConnection();
  }

  async function saveOnlineWinner(optionId, spinVersion) {
    try {
      const { error } = await supabaseClient
        .from("polls")
        .update({ winner_option_id: optionId, spin_version: spinVersion })
        .eq("id", state.online.pollId);
      if (error) throw error;
    } catch (error) {
      showToast(`Ergebnis konnte nicht synchronisiert werden: ${onlineErrorMessage(error)}`);
    }
  }

  function animateParticipantWinner(optionId) {
    if (!optionId || state.screen !== "results" || state.role !== "participant") return;
    const winner = state.options.find((option) => option.id === optionId);
    if (!winner) return;
    pendingParticipantSpin = null;
    let desiredRotation = targetRotationForOption(optionId);
    if (desiredRotation === null) {
      drawWheel();
      desiredRotation = targetRotationForOption(optionId);
    }
    if (desiredRotation === null) return;

    participantSpinInProgress = true;
    spinSequence += 1;
    const currentSpin = spinSequence;
    elements.winnerBanner.hidden = true;
    elements.participantWheelNote.hidden = false;
    elements.participantWheelNote.textContent = "Das Glücksrad dreht sich …";

    const currentRotation = normalizeDegrees(wheelRotation);
    const alignment = normalizeDegrees(desiredRotation - currentRotation);
    wheelRotation += 6 * 360 + alignment;

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
      participantSpinInProgress = false;
      wheelRotation = normalizeDegrees(wheelRotation);
      canvas.style.transition = "none";
      canvas.style.transform = `rotate(${wheelRotation}deg)`;
      elements.winnerText.textContent = winner.text;
      elements.winnerBanner.hidden = false;
      elements.participantWheelNote.hidden = true;
    };

    canvas.addEventListener("transitionend", finishSpin, { once: true });
    window.requestAnimationFrame(() => {
      canvas.style.transform = `rotate(${wheelRotation}deg)`;
    });
    window.setTimeout(finishSpin, duration + 180);
  }

  async function handlePollUpdate(poll) {
    if (!poll || state.mode !== "online" || poll.id !== state.online.pollId) return;
    const previousStatus = state.online.status;
    const previousSpinVersion = state.online.spinVersion || 0;
    const incomingSpinVersion = Number.parseInt(poll.spin_version, 10) || 0;
    const hasNewParticipantSpin =
      state.role === "participant" &&
      poll.winner_option_id &&
      incomingSpinVersion > previousSpinVersion;
    if (hasNewParticipantSpin) {
      pendingParticipantSpin = {
        optionId: poll.winner_option_id,
        spinVersion: incomingSpinVersion
      };
    }
    state.online.status = poll.status;
    state.online.winnerOptionId = poll.winner_option_id || null;
    state.online.spinVersion = incomingSpinVersion;

    if (state.role === "participant" && poll.status === "closed" && previousStatus !== "closed") {
      try {
        await loadOnlineResults();
      } catch (error) {
        elements.participantConnectionLabel.textContent = onlineErrorMessage(error);
      }
      return;
    }

    if (hasNewParticipantSpin && state.screen === "results") {
      pendingParticipantSpin = null;
      animateParticipantWinner(poll.winner_option_id);
    }
  }

  async function pollOnlineStatus() {
    if (state.mode !== "online" || !state.online?.pollId) return;
    const { data, error } = await supabaseClient
      .from("polls")
      .select("id, status, winner_option_id, spin_version")
      .eq("id", state.online.pollId)
      .maybeSingle();
    if (!error && data) await handlePollUpdate(data);
  }

  function cleanupOnlineConnection() {
    if (onlineChannel && supabaseClient) supabaseClient.removeChannel(onlineChannel);
    onlineChannel = null;
    window.clearInterval(onlinePollingTimer);
    onlinePollingTimer = null;
  }

  function subscribeOnline() {
    cleanupOnlineConnection();
    if (!supabaseClient || state.mode !== "online" || !state.online?.pollId) return;
    const pollId = state.online.pollId;
    onlineChannel = supabaseClient.channel(`stimmrad-${pollId}-${Date.now()}`);

    if (state.role === "host") {
      onlineChannel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "votes", filter: `poll_id=eq.${pollId}` },
        () => refreshHostVotes()
      );
    }

    onlineChannel
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "polls", filter: `id=eq.${pollId}` },
        (payload) => handlePollUpdate(payload.new)
      )
      .subscribe((status) => {
        if (state.role === "host" && elements.hostConnectionLabel) {
          elements.hostConnectionLabel.textContent = status === "SUBSCRIBED" ? "Live" : "Wird verbunden";
        }
        if (state.role === "participant" && elements.participantConnectionLabel && status === "SUBSCRIBED") {
          elements.participantConnectionLabel.textContent = "Live verbunden · Warte auf die Moderation …";
        }
      });

    onlinePollingTimer = window.setInterval(() => {
      if (state.role === "host" && state.screen === "onlineHost") refreshHostVotes();
      else pollOnlineStatus();
    }, 3500);
  }

  async function copyJoinLink() {
    const link = buildJoinLink(state.online.code);
    try {
      await navigator.clipboard.writeText(link);
      showToast("Einladungslink wurde kopiert.");
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = link;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      showToast("Einladungslink wurde kopiert.");
    }
  }

  async function leaveOnlineHost() {
    if (state.online.status === "open" && supabaseClient) {
      await supabaseClient
        .from("polls")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", state.online.pollId);
    }
    returnToLocalSetup(true);
  }

  async function restoreOnlineSession() {
    const codeFromUrl = normalizeRoomCode(new URLSearchParams(window.location.search).get("join"));
    let code = codeFromUrl;
    if (!code) {
      try {
        const saved = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY) || "null");
        code = normalizeRoomCode(saved?.code);
      } catch (error) {
        code = "";
      }
    }
    if (!code) return;
    openOnlineJoin(code);
    await joinOnlinePoll(code);
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

  elements.localModeButton.addEventListener("click", () => setSetupMode("local"));
  elements.onlineModeButton.addEventListener("click", () => setSetupMode("online"));

  elements.quickJoinCode.addEventListener("input", () => {
    elements.quickJoinCode.value = normalizeRoomCode(elements.quickJoinCode.value);
  });

  elements.onlineJoinCode.addEventListener("input", () => {
    elements.onlineJoinCode.value = normalizeRoomCode(elements.onlineJoinCode.value);
    elements.onlineJoinError.hidden = true;
  });

  elements.quickJoinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = normalizeRoomCode(elements.quickJoinCode.value);
    openOnlineJoin(code);
    await joinOnlinePoll(code);
  });

  elements.onlineJoinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await joinOnlinePoll(elements.onlineJoinCode.value);
  });

  elements.onlineHomeButtons.forEach((button) => {
    button.addEventListener("click", () => returnToLocalSetup(false));
  });

  elements.setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateSetup()) return;
    if (selectedSetupMode === "online") {
      await createOnlinePoll();
      return;
    }
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
  elements.copyJoinLinkButton.addEventListener("click", copyJoinLink);
  elements.closeOnlinePollButton.addEventListener("click", closeOnlinePoll);
  elements.leaveOnlineHostButton.addEventListener("click", () => {
    requestConfirmation(
      {
        title: "Online-Abstimmung verlassen?",
        text: "Der Raum wird geschlossen. Bereits abgegebene Stimmen bleiben in Supabase gespeichert.",
        confirmLabel: "Raum schließen"
      },
      leaveOnlineHost
    );
  });

  elements.cancelVotingButton.addEventListener("click", () => {
    if (state.mode === "online") {
      returnToLocalSetup(false);
      return;
    }
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
    if (state.mode === "online") {
      requestConfirmation(
        {
          title: "Neue Online-Abstimmung erstellen?",
          text: "Du kehrst zum Setup zurück. Der beendete Raum und seine Stimmen bleiben in Supabase gespeichert.",
          confirmLabel: "Neue Abstimmung"
        },
        () => returnToLocalSetup(true)
      );
      return;
    }
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
    if (state.mode === "online") {
      if (state.role === "participant") {
        returnToLocalSetup(false);
        return;
      }
      requestConfirmation(
        {
          title: "Zum Setup zurückkehren?",
          text: "Der Online-Raum ist bereits beendet. Frage und Optionen bleiben als lokaler Entwurf erhalten.",
          confirmLabel: "Setup öffnen"
        },
        () => returnToLocalSetup(true)
      );
      return;
    }
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
      const participantResult = state.mode === "online" && state.role === "participant";
      if (state.screen === "results" && (participantResult || !elements.spinButton.disabled)) drawWheel();
    }, 120);
  });

  renderApp({ scroll: false });
  restoreOnlineSession();
})();
