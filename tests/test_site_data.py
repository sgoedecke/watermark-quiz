import json
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUIZ_PATH = ROOT / "site" / "data" / "quiz.json"
RESULTS_PATH = ROOT / "site" / "data" / "results.json"
ANALYTICS_HOST = "https://sg-analytics.pikapod.net/script.js"


class SiteDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quiz = json.loads(QUIZ_PATH.read_text(encoding="utf-8"))
        cls.results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))

    def test_quiz_has_ten_questions_with_three_answers(self):
        questions = self.quiz["questions"]
        self.assertEqual(len(questions), 10)
        self.assertEqual(len({question["id"] for question in questions}), 10)
        for question in questions:
            self.assertEqual(len(question["answers"]), 3)
            self.assertEqual(
                {answer["id"] for answer in question["answers"]},
                {"A", "B", "C"},
            )

    def test_results_match_quiz_and_correct_labels_map_to_answers(self):
        quiz_by_id = {
            question["id"]: question for question in self.quiz["questions"]
        }
        result_by_id = {
            question["id"]: question for question in self.results["questions"]
        }
        self.assertEqual(result_by_id.keys(), quiz_by_id.keys())

        for question_id, result in result_by_id.items():
            public_labels = {
                answer["id"] for answer in quiz_by_id[question_id]["answers"]
            }
            result_labels = {answer["id"] for answer in result["answers"]}
            self.assertEqual(result_labels, public_labels)
            self.assertIn(result["correct_answer"], public_labels)
            highest_score = max(
                result["answers"],
                key=lambda answer: answer["weighted_mean_score"],
            )
            self.assertEqual(highest_score["id"], result["correct_answer"])

        correct_positions = Counter(
            question["correct_answer"]
            for question in self.results["questions"]
        )
        self.assertEqual(correct_positions, {"A": 4, "B": 3, "C": 3})

    def test_public_quiz_schema_contains_no_private_metadata(self):
        self.assertEqual(
            set(self.quiz),
            {"title", "instructions", "model", "questions"},
        )
        for question in self.quiz["questions"]:
            self.assertEqual(set(question), {"id", "prompt", "answers"})
            for answer in question["answers"]:
                self.assertEqual(set(answer), {"id", "text"})

    def test_results_are_strictly_sanitized(self):
        self.assertEqual(set(self.results), {"questions"})
        forbidden_fields = {
            "condition",
            "generation",
            "generation_seed",
            "keys",
            "quiz_seed",
            "sampling_table_seed",
            "watermark",
            "watermark_depth",
        }

        def assert_no_forbidden_fields(value):
            if isinstance(value, dict):
                self.assertTrue(forbidden_fields.isdisjoint(value))
                for child in value.values():
                    assert_no_forbidden_fields(child)
            elif isinstance(value, list):
                for child in value:
                    assert_no_forbidden_fields(child)

        assert_no_forbidden_fields(self.results)
        for question in self.results["questions"]:
            self.assertEqual(
                set(question),
                {"id", "correct_answer", "answers"},
            )
            self.assertEqual(len(question["answers"]), 3)
            for answer in question["answers"]:
                self.assertEqual(
                    set(answer),
                    {"id", "weighted_mean_score", "top_positions"},
                )
                self.assertIsInstance(answer["weighted_mean_score"], (int, float))
                self.assertLessEqual(len(answer["top_positions"]), 3)
                for position in answer["top_positions"]:
                    self.assertEqual(
                        set(position),
                        {"token_index", "token", "context", "weighted_score"},
                    )

    def test_score_routes_and_analytics_exist(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn(ANALYTICS_HOST, index)
        for score in range(11):
            page = ROOT / "site" / str(score) / "index.html"
            self.assertTrue(page.exists())
            contents = page.read_text(encoding="utf-8")
            self.assertIn(f"{score}<span>/10</span>", contents)
            self.assertIn(ANALYTICS_HOST, contents)
            self.assertIn('href="../?review=1"', contents)
            self.assertNotIn("Chance performance", contents)
            self.assertNotIn("<footer", contents)
            if score <= 3:
                self.assertIn("You did worse than random chance", contents)
                self.assertIn("score-route__message--low", contents)
            elif score < 10:
                self.assertIn(
                    "You did slightly better than random chance",
                    contents,
                )
            else:
                self.assertIn(
                    "You guessed them all correctly, nice work",
                    contents,
                )

    def test_main_page_omits_removed_chrome(self):
        contents = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<header", contents)
        self.assertNotIn("<footer", contents)
        self.assertNotIn("clear-progress", contents)
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        for removed_text in (
            "A blind comparison in ten rounds",
            "Blind comparison",
            "Choose one response to continue.",
            "Review selections",
            "renderConfirmation",
            "The marked snippets below show three high-scoring token contexts",
            "review-previous",
            "review-next",
        ):
            self.assertNotIn(removed_text, app)
        self.assertIn("renderReviewQuestion", app)
        self.assertIn("review-page", app)
        self.assertIn(
            'href="https://deepmind.google/technologies/synthid/"',
            app,
        )
        self.assertIn(
            "This quiz contains ten prompts with three responses each.",
            app,
        )


if __name__ == "__main__":
    unittest.main()
