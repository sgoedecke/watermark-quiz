"use strict";

const STORAGE_KEY = "watermark-field-test-v1";
const app = document.querySelector("#app");

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
        screen: ["intro", "quiz", "review"].includes(saved.screen)
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
    state.screen = "review";
  } else if (state.screen === "review") {
    state.screen = "quiz";
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The quiz remains usable when storage is disabled.
  }
}

function scrollToTop() {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
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

function renderIntro() {
  const hasProgress = Object.keys(state.answers).length > 0;
  app.innerHTML = `
    <section class="intro" aria-labelledby="intro-title">
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
          ${hasProgress ? `Resume at question ${state.current + 1}` : "Begin"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  `;

  document
    .querySelector("#start-quiz")
    .addEventListener("click", () => setScreen("quiz", state.current));
}

function renderQuestion() {
  const question = quiz.questions[state.current];
  const isLast = state.current === quiz.questions.length - 1;
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
          >
          <span class="answer-body">
            <span class="answer-label-row">
              <span class="answer-letter">${escapeHtml(answer.id)}</span>
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
        <h1 id="question-title">Question ${state.current + 1} / ${quiz.questions.length}</h1>
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
    </section>
  `;

  document.querySelectorAll(".answer-radio").forEach((radio) => {
    radio.addEventListener("change", async (event) => {
      state.answers[question.id] = event.target.value;
      saveState();

      if (!isLast) {
        setScreen("quiz", state.current + 1);
        return;
      }

      document
        .querySelectorAll(".answer-radio")
        .forEach((input) => (input.disabled = true));
      try {
        await loadResults();
        state.submitted = true;
        state.screen = "review";
        saveState();
        goToScorePage();
      } catch (error) {
        delete state.answers[question.id];
        saveState();
        event.target.checked = false;
        document
          .querySelectorAll(".answer-radio")
          .forEach((input) => (input.disabled = false));
        showInlineError(error.message);
      }
    });
  });
}

function scoreQuiz() {
  return results.questions.reduce(
    (total, question) =>
      total + Number(state.answers[question.id] === question.correct_answer),
    0,
  );
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
  if (state.screen === "intro") {
    renderIntro();
  } else if (state.screen === "quiz") {
    renderQuestion();
  } else {
    renderReview();
  }
}

async function start() {
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
