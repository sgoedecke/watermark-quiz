#!/usr/bin/env python3
"""Add per-token SynthID detector evidence to an existing answer key."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer, SynthIDTextWatermarkingConfig

from generate_quiz import detector_evidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiz", type=Path, default=Path("output/quiz.json"))
    parser.add_argument(
        "--answer-key",
        type=Path,
        default=Path("output/answer-key.json"),
    )
    parser.add_argument("--top-k", type=int, default=10)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    quiz = json.loads(args.quiz.read_text(encoding="utf-8"))
    answer_key = json.loads(args.answer_key.read_text(encoding="utf-8"))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    tokenizer = AutoTokenizer.from_pretrained(
        answer_key["model"],
        padding_side="left",
    )
    watermark = answer_key["watermark"]
    config = SynthIDTextWatermarkingConfig(
        keys=watermark["keys"],
        ngram_len=watermark["ngram_len"],
        sampling_table_seed=watermark["sampling_table_seed"],
        sampling_table_size=watermark["sampling_table_size"],
        context_history_size=watermark["context_history_size"],
    )
    processor = config.construct_processor(
        vocab_size=len(tokenizer),
        device=device,
    )

    public_by_id = {
        question["id"]: question
        for question in quiz["questions"]
    }
    for private_question in answer_key["questions"]:
        public_question = public_by_id[private_question["id"]]
        text_by_id = {
            answer["id"]: answer["text"]
            for answer in public_question["answers"]
        }
        for answer in private_question["answers"]:
            text = text_by_id[answer["id"]]
            token_ids = tokenizer(
                text,
                add_special_tokens=False,
                return_tensors="pt",
            )["input_ids"][0]
            answer["detector_evidence"] = detector_evidence(
                token_ids=token_ids,
                tokenizer=tokenizer,
                processor=processor,
                device=device,
                eos_token_id=tokenizer.eos_token_id,
                top_k=args.top_k,
            )

    args.answer_key.write_text(
        json.dumps(answer_key, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Annotated {args.answer_key} on {device}")


if __name__ == "__main__":
    main()
