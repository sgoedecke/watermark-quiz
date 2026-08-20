import random
import tempfile
import unittest
from pathlib import Path

from generate_quiz import assemble_outputs, load_prompts, parse_watermark_keys


class GenerateQuizTest(unittest.TestCase):
    def test_load_prompts_requires_exactly_ten_unique_prompts(self):
        prompts = [{"id": f"p{i}", "prompt": f"Prompt {i}"} for i in range(10)]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prompts.json"
            path.write_text(__import__("json").dumps(prompts), encoding="utf-8")
            self.assertEqual(load_prompts(path), prompts)

    def test_parse_watermark_keys_rejects_duplicates(self):
        with self.assertRaisesRegex(ValueError, "unique"):
            parse_watermark_keys("1,2,1")

    def test_assemble_outputs_hides_and_randomizes_condition(self):
        prompts = [{"id": f"p{i}", "prompt": f"Prompt {i}"} for i in range(10)]
        candidates = {}
        for prompt in prompts:
            candidates[prompt["id"]] = [
                {
                    "condition": "synthid",
                    "generation_seed": 1,
                    "detector_evidence": {"weighted_mean_score": 0.75},
                    "text": f"{prompt['id']} synthid",
                },
                {
                    "condition": "plain",
                    "generation_seed": 2,
                    "detector_evidence": {"weighted_mean_score": 0.50},
                    "text": f"{prompt['id']} plain one",
                },
                {
                    "condition": "plain",
                    "generation_seed": 3,
                    "detector_evidence": {"weighted_mean_score": 0.49},
                    "text": f"{prompt['id']} plain two",
                },
            ]

        public, private = assemble_outputs(
            prompts=prompts,
            candidates=candidates,
            model_name="test/model",
            generation_args={"temperature": 0.8},
            seed=42,
            watermark_config={"keys": [1, 2]},
        )

        positions = []
        for public_question, private_question in zip(
            public["questions"], private["questions"]
        ):
            self.assertEqual(len(public_question["answers"]), 3)
            self.assertNotIn("condition", str(public_question))
            self.assertEqual(
                sum(
                    answer["condition"] == "synthid"
                    for answer in private_question["answers"]
                ),
                1,
            )
            positions.append(private_question["watermarked_answer"])
            self.assertIn(
                "detector_evidence",
                private_question["answers"][0],
            )

        self.assertGreater(len(set(positions)), 1)

    def test_shuffle_is_reproducible(self):
        first = list(range(20))
        second = list(range(20))
        random.Random(7).shuffle(first)
        random.Random(7).shuffle(second)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
