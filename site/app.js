"use strict";

const STORAGE_KEY = "watermark-field-test-v1";
const app = document.querySelector("#app");
const clearButton = document.querySelector("#clear-progress");

let quiz;
let results;
let state = {
  screen: "intro",
  current: 0,
  answers: {},
  submitted: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      saved &&
      typeof saved === "object" &&
      saved.answers &&
      typeof saved.answers === "object"
    ) {
      state = {
        screen: ["intro", "quiz", "confirm", "results", "review"].includes(
          saved.screen,
        )
          ? saved.screen
          : "intro",
        current: Number.isInteger(saved.current) ? saved.current : 0,
        answers: saved.answers,
        submitted: saved.submitted === true,
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function cleanState() {
  const validQuestions = new Map(
    quiz.questions.map((question) => [
      question.id,
      new Set(question.answers.map((answer) => answer.id)),
    ]),
  );
  state.answers = Object.fromEntries(
    Object.entries(state.answers).filter(
      ([questionId, answerId]) =>
        validQuestions.has(questionId) &&
        validQuestions.get(questionId).has(answerId),
    ),
  );
  state.current = Math.max(
    0,
    Math.min(state.current, quiz.questions.length - 1),
  );
  if (
    state.submitted &&
    Object.keys(state.answers).length !== quiz.questions.length
  ) {
    state.submitted = false;
    state.screen = "quiz";
  }
  if (state.submitted) {
    state.screen = ["results", "review"].includes(state.screen)
      ? state.screen
      : "results";
  } else if (["results", "review"].includes(state.screen)) {
    state.screen = "quiz";
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The quiz remains usable when storage is disabled.
  }
  updateClearButton();
}

function scrollToTop() {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

function updateClearButton() {
  clearButton.hidden =
    Object.keys(state.answers).length === 0 &&
    state.screen === "intro" &&
    !state.submitted;
}

function setScreen(screen, current = state.current) {
  state.screen = screen;
  state.current = current;
  saveState();
  render();
  scrollToTop();
  app.focus({ preventScroll: true });
}

function scorePageUrl() {
  return `${scoreQuiz()}/`;
}

function goToScorePage() {
  window.location.assign(scorePageUrl());
}

function clearProgress() {
  const hasProgress =
    Object.keys(state.answers).length > 0 || state.submitted === true;
  if (
    hasProgress &&
    !window.confirm("Clear your answers and restart the quiz?")
  ) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  state = {
    screen: "intro",
    current: 0,
    answers: {},
    submitted: false,
  };
  results = undefined;
  updateClearButton();
  renderIntro();
  scrollToTop();
  app.focus({ preventScroll: true });
}

async function loadResults() {
  if (results) {
    return results;
  }
  const response = await fetch("data/results.json");
  if (!response.ok) {
    throw new Error(`Results could not be loaded (${response.status}).`);
  }
  results = await response.json();
  return results;
}

function answeredCount() {
  return quiz.questions.filter((question) => state.answers[question.id]).length;
}

function renderIntro() {
  const count = answeredCount();
  const hasProgress = count > 0;
  app.innerHTML = `
    <section class="intro" aria-labelledby="intro-title">
      <p class="eyebrow">A blind comparison in ten rounds</p>
      <h1 class="display-title" id="intro-title">
        Can you spot the <em>watermark?</em>
      </h1>
      <p class="lede">
        You will read three responses to each prompt. All thirty were produced
        by the same Qwen model; exactly one response in each set was generated
        with SynthID.
      </p>
      <div class="intro-actions">
        <button class="button button--primary" id="start-quiz" type="button">
          ${hasProgress ? `Resume at question ${state.current + 1}` : "Begin the field test"}
          <span aria-hidden="true">→</span>
        </button>
        ${
          hasProgress
            ? `<button class="text-button" id="restart-intro" type="button">
                Start over and clear ${count} ${count === 1 ? "answer" : "answers"}
              </button>`
            : ""
        }
      </div>

      <div class="method-grid" aria-label="How the quiz works">
        <article class="method-card">
          <span class="method-card__number" aria-hidden="true">01</span>
          <h2>Read the prompt</h2>
          <p>Ten varied prompts, presented one at a time. There is no time limit.</p>
        </article>
        <article class="method-card">
          <span class="method-card__number" aria-hidden="true">02</span>
          <h2>Compare three answers</h2>
          <p>Choose the one you think contains SynthID. You can go back and revise.</p>
        </article>
        <article class="method-card">
          <span class="method-card__number" aria-hidden="true">03</span>
          <h2>Review the evidence</h2>
          <p>Correct answers and aggregate detector evidence appear only after submission.</p>
        </article>
      </div>

      <aside class="science-note" aria-labelledby="science-title">
        <h2 id="science-title">What “non-distortionary” means</h2>
        <p>
          SynthID does not add a visible marker or edit finished prose. During
          generation, a keyed scoring function guides token sampling so a
          statistical pattern accumulates while preserving the model’s overall
          token distribution. A keyed detector later looks for that pattern
          across many token sequences. This quiz is an informal demonstration
          of how the output reads to people, not proof that a watermark is
          imperceptible in every setting.
        </p>
      </aside>
    </section>
  `;

  document
    .querySelector("#start-quiz")
    .addEventListener("click", () => setScreen("quiz", state.current));
  document
    .querySelector("#restart-intro")
    ?.addEventListener("click", clearProgress);
}

function renderQuestion() {
  const question = quiz.questions[state.current];
  const selected = state.answers[question.id];
  const isLast = state.current === quiz.questions.length - 1;
  const count = answeredCount();
  const progress = ((state.current + 1) / quiz.questions.length) * 100;

  const cards = question.answers
    .map(
      (answer) => `
        <label class="answer-card">
          <input
            class="answer-radio"
            type="radio"
            name="answer"
            value="${escapeHtml(answer.id)}"
            ${selected === answer.id ? "checked" : ""}
          >
          <span class="answer-body">
            <span class="answer-label-row">
              <span class="answer-letter">${escapeHtml(answer.id)}</span>
              <span class="selection-state">
                ${selected === answer.id ? "Selected" : "Select response"}
              </span>
            </span>
            <span class="answer-text">${escapeHtml(answer.text)}</span>
          </span>
        </label>
      `,
    )
    .join("");

  app.innerHTML = `
    <section class="quiz" aria-labelledby="question-title">
      <header class="quiz-header">
        <div>
          <p class="eyebrow">Blind comparison</p>
          <h1 id="question-title">Question ${state.current + 1}</h1>
        </div>
        <div class="progress-copy" aria-label="${count} of ${quiz.questions.length} answered">
          <strong>${state.current + 1} / ${quiz.questions.length}</strong>
          ${count} answered
        </div>
        <div
          class="progress-track"
          role="progressbar"
          aria-valuemin="1"
          aria-valuemax="${quiz.questions.length}"
          aria-valuenow="${state.current + 1}"
          aria-label="Quiz progress"
        >
          <span style="width: ${progress}%"></span>
        </div>
      </header>

      <div class="prompt-panel">
        <p>${escapeHtml(question.prompt)}</p>
      </div>

      <fieldset class="answer-fieldset">
        <legend class="sr-only">
          Which response do you think contains the SynthID watermark?
        </legend>
        <div class="answers-grid">${cards}</div>
      </fieldset>

      <nav class="quiz-nav" aria-label="Question navigation">
        <button
          class="button"
          id="previous-question"
          type="button"
          ${state.current === 0 ? "disabled" : ""}
        >
          <span aria-hidden="true">←</span> Back
        </button>
        <p class="quiz-nav__hint" id="selection-hint">
          ${selected ? `Response ${escapeHtml(selected)} selected.` : "Choose one response to continue."}
        </p>
        <button
          class="button button--primary"
          id="next-question"
          type="button"
          ${selected ? "" : "disabled"}
        >
          ${isLast ? "Review selections" : "Next"} <span aria-hidden="true">→</span>
        </button>
      </nav>
    </section>
  `;

  document.querySelectorAll(".answer-radio").forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.answers[question.id] = event.target.value;
      saveState();
      renderQuestion();
      document
        .querySelector(`.answer-radio[value="${event.target.value}"]`)
        ?.focus();
    });
  });
  document
    .querySelector("#previous-question")
    .addEventListener("click", () =>
      setScreen("quiz", Math.max(0, state.current - 1)),
    );
  document.querySelector("#next-question").addEventListener("click", () => {
    if (!state.answers[question.id]) {
      return;
    }
    if (isLast) {
      setScreen("confirm");
    } else {
      setScreen("quiz", state.current + 1);
    }
  });
}

function renderConfirmation() {
  if (answeredCount() !== quiz.questions.length) {
    const firstUnanswered = quiz.questions.findIndex(
      (question) => !state.answers[question.id],
    );
    setScreen("quiz", Math.max(firstUnanswered, 0));
    return;
  }

  const summary = quiz.questions
    .map(
      (question, index) => `
        <li>
          <button class="summary-item" type="button" data-question="${index}">
            <span>Question ${index + 1}</span>
            <strong aria-label="Selected response ${escapeHtml(state.answers[question.id])}">
              ${escapeHtml(state.answers[question.id])}
            </strong>
          </button>
        </li>
      `,
    )
    .join("");

  app.innerHTML = `
    <section class="confirm-panel" aria-labelledby="confirm-title">
      <p class="eyebrow">Final check</p>
      <h1 id="confirm-title">Ready to reveal the pattern?</h1>
      <p class="confirm-intro">
        All ten questions are answered. Select any item to revisit it, or submit
        now to lock your choices and see your score. No correctness information
        has been shown yet.
      </p>
      <ol class="answer-summary">${summary}</ol>
      <div class="confirm-actions">
        <button class="button" id="return-to-last" type="button">
          <span aria-hidden="true">←</span> Return to quiz
        </button>
        <button class="button button--coral" id="submit-quiz" type="button">
          Submit and reveal results
        </button>
      </div>
    </section>
  `;

  document.querySelectorAll(".summary-item").forEach((button) => {
    button.addEventListener("click", () =>
      setScreen("quiz", Number(button.dataset.question)),
    );
  });
  document
    .querySelector("#return-to-last")
    .addEventListener("click", () =>
      setScreen("quiz", quiz.questions.length - 1),
    );
  document.querySelector("#submit-quiz").addEventListener("click", async () => {
    const submitButton = document.querySelector("#submit-quiz");
    submitButton.disabled = true;
    submitButton.textContent = "Loading detector results…";
    try {
      await loadResults();
      state.submitted = true;
      state.screen = "review";
      saveState();
      goToScorePage();
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = "Try submitting again";
      showInlineError(error.message);
    }
  });
}

function scoreQuiz() {
  return results.questions.reduce(
    (total, question) =>
      total + Number(state.answers[question.id] === question.correct_answer),
    0,
  );
}

function resultMessage(score) {
  if (score >= 8) {
    return "You found a strong signal in this set of responses.";
  }
  if (score >= 5) {
    return "You identified the pattern more often than not in this set.";
  }
  return "The marked responses were difficult to distinguish in this set.";
}

function renderResults() {
  const score = scoreQuiz();
  app.innerHTML = `
    <section aria-labelledby="results-title">
      <div class="results-hero">
        <div class="score-seal" aria-label="${score} correct out of 10">
          <div>
            <span>${score}/10</span>
            <small>responses found</small>
          </div>
        </div>
        <div class="result-copy">
          <p class="eyebrow">Your result</p>
          <h1 id="results-title">${escapeHtml(resultMessage(score))}</h1>
          <p class="result-lede">
            Your score describes these ten comparisons only. It does not
            establish whether SynthID is perceptible in general.
          </p>
          <p class="baseline-note">Chance baseline: 3.33 correct out of 10</p>
          <div class="result-actions">
            <button class="button button--primary" id="review-results" type="button">
              Review answers and evidence <span aria-hidden="true">→</span>
            </button>
            <button class="text-button" id="restart-results" type="button">
              Clear and take it again
            </button>
          </div>
        </div>
      </div>
      <aside class="result-caveat">
        <strong>How to read the detector:</strong> the weighted mean is an
        aggregate keyed n-gram score, not a probability that a response is
        watermarked. High-scoring token positions are diagnostic contributions
        to that aggregate pattern—not visibly “watermarked words.”
      </aside>
    </section>
  `;

  document
    .querySelector("#review-results")
    .addEventListener("click", () => setScreen("review", 0));
  document
    .querySelector("#restart-results")
    .addEventListener("click", clearProgress);
}

function renderEvidence(positions) {
  if (!positions.length) {
    return "";
  }
  return `
    <ol class="evidence-list" aria-label="Three highest-scoring token contexts">
      ${positions
        .map(
          (position) => `
            <li>
              Token ${position.token_index}:
              <mark>${escapeHtml(position.token.trim() || position.token)}</mark>
              in <q>${escapeHtml(position.context)}</q>
              <span>(${position.weighted_score.toFixed(3)})</span>
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function renderReview() {
  const question = quiz.questions[state.current];
  const result = results.questions.find((item) => item.id === question.id);
  const selected = state.answers[question.id];
  const progress = ((state.current + 1) / quiz.questions.length) * 100;

  const cards = question.answers
    .map((answer) => {
      const answerResult = result.answers.find((item) => item.id === answer.id);
      const isCorrect = answer.id === result.correct_answer;
      const isPicked = answer.id === selected;
      const classes = [
        "answer-card",
        "review-card",
        isCorrect ? "review-card--correct" : "",
        isPicked ? "review-card--picked" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <article class="${classes}">
          <div class="answer-body">
            <div class="answer-label-row">
              <span class="answer-letter">${escapeHtml(answer.id)}</span>
              <span class="review-badges">
                ${isPicked ? '<span class="badge badge--picked">Your pick</span>' : ""}
                ${isCorrect ? '<span class="badge badge--correct">SynthID answer</span>' : ""}
              </span>
            </div>
            <p class="answer-text">${escapeHtml(answer.text)}</p>
            <div class="detector-panel">
              <p class="detector-score">
                Weighted mean detector score
                <strong>${answerResult.weighted_mean_score.toFixed(4)}</strong>
              </p>
              ${renderEvidence(answerResult.top_positions)}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  app.innerHTML = `
    <section class="quiz" aria-labelledby="review-title">
      <header class="quiz-header">
        <div>
          <p class="eyebrow">Evidence review</p>
          <h1 id="review-title">Question ${state.current + 1}</h1>
        </div>
        <div class="progress-copy">
          <strong>${state.current + 1} / ${quiz.questions.length}</strong>
          review
        </div>
        <div class="progress-track" aria-hidden="true">
          <span style="width: ${progress}%"></span>
        </div>
      </header>

      <p class="review-intro">
        The marked snippets below show three high-scoring token contexts for
        each response. They are aggregate keyed n-gram evidence, not visible
        watermark marks or individually decisive words. Scores are comparative
        diagnostics rather than calibrated probabilities.
      </p>

      <div class="prompt-panel">
        <p>${escapeHtml(question.prompt)}</p>
      </div>
      <div class="answers-grid review-grid">${cards}</div>

      <nav class="quiz-nav" aria-label="Review navigation">
        <button class="button" id="review-previous" type="button">
          ${
            state.current === 0
              ? '<span aria-hidden="true">←</span> Score'
              : '<span aria-hidden="true">←</span> Previous'
          }
        </button>
        <p class="quiz-nav__hint">
          Your pick: ${escapeHtml(selected)} · Correct: ${escapeHtml(result.correct_answer)}
        </p>
        <button class="button button--primary" id="review-next" type="button">
          ${
            state.current === quiz.questions.length - 1
              ? "Back to score"
              : 'Next <span aria-hidden="true">→</span>'
          }
        </button>
      </nav>
    </section>
  `;

  document.querySelector("#review-previous").addEventListener("click", () => {
    if (state.current === 0) {
      goToScorePage();
    } else {
      setScreen("review", state.current - 1);
    }
  });
  document.querySelector("#review-next").addEventListener("click", () => {
    if (state.current === quiz.questions.length - 1) {
      goToScorePage();
    } else {
      setScreen("review", state.current + 1);
    }
  });
}

function showInlineError(message) {
  document.querySelector(".error-panel")?.remove();
  const panel = document.createElement("p");
  panel.className = "error-panel";
  panel.setAttribute("role", "alert");
  panel.textContent = message;
  app.append(panel);
}

function renderError(error) {
  app.innerHTML = `
    <section class="error-panel" role="alert">
      <p class="eyebrow">Unable to start</p>
      <h1>The quiz data could not be loaded.</h1>
      <p>${escapeHtml(error.message)}</p>
      <p>Serve the <code>site/</code> directory over HTTP, then reload this page.</p>
    </section>
  `;
}

function render() {
  updateClearButton();
  if (state.screen === "intro") {
    renderIntro();
  } else if (state.screen === "quiz") {
    renderQuestion();
  } else if (state.screen === "confirm") {
    renderConfirmation();
  } else if (state.screen === "results") {
    renderResults();
  } else {
    renderReview();
  }
}

async function start() {
  clearButton.addEventListener("click", clearProgress);
  const params = new URLSearchParams(window.location.search);
  if (params.get("restart") === "1") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    loadState();
  }
  try {
    const response = await fetch("data/quiz.json");
    if (!response.ok) {
      throw new Error(`Quiz data could not be loaded (${response.status}).`);
    }
    quiz = await response.json();
    cleanState();
    if (state.submitted) {
      await loadResults();
    }
    if (params.get("review") === "1" && state.submitted) {
      state.screen = "review";
      state.current = 0;
      saveState();
    }
    if (params.has("review") || params.has("restart")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    render();
  } catch (error) {
    renderError(error);
  }
}

start();
