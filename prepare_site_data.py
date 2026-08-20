#!/usr/bin/env python3
"""Sanitize generated quiz output and build the publishable static site data."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
SITE_DIR = ROOT / "site"
ANALYTICS_SCRIPT = """    <script
      defer
      src="https://sg-analytics.pikapod.net/script.js"
      data-website-id="28fc1c5a-fc77-4fe1-af5c-a2f4b2432e1f"
    ></script>"""


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def sanitize_results(answer_key: dict[str, Any]) -> dict[str, Any]:
    questions = []
    for question in answer_key["questions"]:
        answers = []
        for answer in question["answers"]:
            evidence = answer["detector_evidence"]
            positions = [
                {
                    "token_index": position["token_index"],
                    "token": position["token_text"],
                    "context": position["ngram_text"],
                    "weighted_score": round(position["weighted_g_score"], 6),
                }
                for position in evidence["top_positions"][:3]
            ]
            answers.append(
                {
                    "id": answer["id"],
                    "weighted_mean_score": round(
                        evidence["weighted_mean_score"],
                        6,
                    ),
                    "top_positions": positions,
                }
            )
        questions.append(
            {
                "id": question["id"],
                "correct_answer": question["watermarked_answer"],
                "answers": answers,
            }
        )
    return {"questions": questions}


def score_message(score: int) -> str:
    if score == 10:
        return "You guessed them all correctly, nice work"
    if score >= 4:
        return "You did slightly better than random chance"
    return "You did worse than random chance"


def score_page(score: int) -> str:
    message = score_message(score)
    message_class = " score-route__message--low" if score <= 3 else ""
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="A score from the Watermark Field Test.">
    <meta name="theme-color" content="#f4efe5">
    <title>{score}/10 · The Watermark Field Test</title>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="../styles.css">
{ANALYTICS_SCRIPT}
  </head>
  <body>
    <a class="skip-link" href="#score">Skip to score</a>
    <main class="site-main score-route" id="score">
      <section class="score-route__panel" aria-labelledby="score-title">
        <p class="eyebrow">Your result</p>
        <p class="score-route__number">{score}<span>/10</span></p>
        <h1 class="score-route__message{message_class}" id="score-title">{message}</h1>
        <div class="score-route__actions">
          <a class="button button--primary" href="../?review=1">
            Review answers and evidence <span aria-hidden="true">→</span>
          </a>
          <a class="button" href="../?restart=1">Clear and take it again</a>
        </div>
      </section>
    </main>
  </body>
</html>
"""


def main() -> None:
    quiz = read_json(OUTPUT_DIR / "quiz.json")
    answer_key = read_json(OUTPUT_DIR / "answer-key.json")
    write_json(SITE_DIR / "data" / "quiz.json", quiz)
    write_json(
        SITE_DIR / "data" / "results.json",
        sanitize_results(answer_key),
    )

    for score in range(11):
        path = SITE_DIR / str(score) / "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(score_page(score), encoding="utf-8")

    print("Prepared site data and score pages 0 through 10")


if __name__ == "__main__":
    main()
