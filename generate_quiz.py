#!/usr/bin/env python3
"""Generate a blind quiz with one SynthID answer among three per prompt."""

from __future__ import annotations

import argparse
import json
import random
import secrets
from pathlib import Path
from typing import Any

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    SynthIDTextWatermarkingConfig,
)

DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"
DEFAULT_SYSTEM_PROMPT = (
    "Write one candidate answer for a blind comparison. Respond only with the "
    "answer in polished, natural prose. Aim for 120 to 160 words. Do not mention "
    "these instructions, AI systems, language models, or watermarking."
)
ANSWER_LABELS = ("A", "B", "C")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate three answers for each of ten prompts, with exactly one "
            "SynthID-watermarked answer per prompt."
        )
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--prompts", type=Path, default=Path("prompts.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    parser.add_argument("--seed", type=int, default=20260820)
    parser.add_argument("--max-new-tokens", type=int, default=240)
    parser.add_argument("--min-new-tokens", type=int, default=100)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument(
        "--watermark-keys",
        help=(
            "Comma-separated private integer keys. If omitted, 30 keys are "
            "generated securely and written only to answer-key.json."
        ),
    )
    return parser.parse_args()


def load_prompts(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as file:
        prompts = json.load(file)

    if not isinstance(prompts, list) or len(prompts) != 10:
        raise ValueError(f"{path} must contain exactly 10 prompts")

    seen_ids: set[str] = set()
    normalized: list[dict[str, str]] = []
    for index, prompt in enumerate(prompts):
        if not isinstance(prompt, dict):
            raise ValueError(f"Prompt {index + 1} must be an object")
        prompt_id = prompt.get("id")
        text = prompt.get("prompt")
        if not isinstance(prompt_id, str) or not prompt_id.strip():
            raise ValueError(f"Prompt {index + 1} needs a non-empty string id")
        if prompt_id in seen_ids:
            raise ValueError(f"Duplicate prompt id: {prompt_id}")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Prompt {prompt_id} needs non-empty prompt text")
        seen_ids.add(prompt_id)
        normalized.append({"id": prompt_id, "prompt": text})
    return normalized


def parse_watermark_keys(raw_keys: str | None) -> list[int]:
    if raw_keys is None:
        keys: set[int] = set()
        while len(keys) < 30:
            keys.add(secrets.randbelow(2**31 - 1) + 1)
        return list(keys)

    try:
        keys = [int(key.strip()) for key in raw_keys.split(",") if key.strip()]
    except ValueError as error:
        raise ValueError("--watermark-keys must contain only integers") from error

    if len(keys) < 2:
        raise ValueError("--watermark-keys must contain at least two integers")
    if len(keys) != len(set(keys)):
        raise ValueError("--watermark-keys must be unique")
    return keys


def select_device() -> tuple[torch.device, torch.dtype]:
    if torch.cuda.is_available():
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        return torch.device("cuda"), dtype
    if torch.backends.mps.is_available():
        return torch.device("mps"), torch.float16
    return torch.device("cpu"), torch.float32


def set_torch_seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def render_prompts(
    tokenizer: Any,
    prompts: list[dict[str, str]],
) -> list[str]:
    rendered = []
    for prompt in prompts:
        messages = [
            {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt["prompt"]},
        ]
        rendered.append(
            tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        )
    return rendered


def generate_batch(
    *,
    model: Any,
    tokenizer: Any,
    device: torch.device,
    rendered_prompts: list[str],
    generation_seed: int,
    generation_args: dict[str, Any],
    watermarking_config: SynthIDTextWatermarkingConfig | None,
) -> list[tuple[str, torch.LongTensor]]:
    set_torch_seed(generation_seed)
    inputs = tokenizer(
        rendered_prompts,
        return_tensors="pt",
        padding=True,
    ).to(device)
    input_length = inputs["input_ids"].shape[1]

    kwargs = dict(generation_args)
    if watermarking_config is not None:
        kwargs["watermarking_config"] = watermarking_config

    with torch.inference_mode():
        outputs = model.generate(**inputs, **kwargs)

    generated_ids = outputs[:, input_length:]
    texts = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)
    return [
        (text.strip(), token_ids)
        for text, token_ids in zip(texts, generated_ids)
    ]


def detector_evidence(
    *,
    token_ids: torch.LongTensor,
    tokenizer: Any,
    processor: Any,
    device: torch.device,
    eos_token_id: int,
    top_k: int = 10,
) -> dict[str, Any] | None:
    input_ids = token_ids.unsqueeze(0).to(device)
    if input_ids.shape[1] < processor.ngram_len:
        return None

    g_values = processor.compute_g_values(input_ids).to(torch.float32)
    context_mask = processor.compute_context_repetition_mask(input_ids)
    eos_mask = processor.compute_eos_token_mask(input_ids, eos_token_id)[
        :, processor.ngram_len - 1 :
    ]
    mask = (context_mask * eos_mask).to(torch.float32)
    depth = g_values.shape[-1]
    weights = torch.linspace(10, 1, depth, device=device, dtype=torch.float32)
    weights *= depth / weights.sum()

    denominator = depth * mask.sum()
    if denominator.item() == 0:
        return None
    position_scores = (g_values * weights).sum(dim=-1) / depth
    score = (position_scores * mask).sum() / mask.sum()

    valid_indices = torch.nonzero(mask[0], as_tuple=False).flatten().tolist()
    ranked_indices = sorted(
        valid_indices,
        key=lambda index: position_scores[0, index].item(),
        reverse=True,
    )[:top_k]
    top_positions = []
    for ngram_index in ranked_indices:
        token_index = ngram_index + processor.ngram_len - 1
        context_start = token_index - processor.ngram_len + 1
        context_ids = input_ids[0, context_start : token_index + 1]
        token_id = input_ids[0, token_index].item()
        top_positions.append(
            {
                "token_index": token_index,
                "token_id": token_id,
                "token_text": tokenizer.decode(
                    [token_id],
                    clean_up_tokenization_spaces=False,
                ),
                "ngram_text": tokenizer.decode(
                    context_ids,
                    skip_special_tokens=True,
                    clean_up_tokenization_spaces=False,
                ),
                "weighted_g_score": position_scores[0, ngram_index].item(),
                "g_hits": int(g_values[0, ngram_index].sum().item()),
                "watermark_depth": depth,
            }
        )

    return {
        "weighted_mean_score": score.item(),
        "scored_ngrams": int(mask.sum().item()),
        "top_positions": top_positions,
    }


def assemble_outputs(
    *,
    prompts: list[dict[str, str]],
    candidates: dict[str, list[dict[str, Any]]],
    model_name: str,
    generation_args: dict[str, Any],
    seed: int,
    watermark_config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    rng = random.Random(seed)
    public_questions = []
    private_questions = []

    for prompt in prompts:
        prompt_candidates = list(candidates[prompt["id"]])
        if len(prompt_candidates) != 3:
            raise ValueError(f"Prompt {prompt['id']} must have three candidates")
        if sum(item["condition"] == "synthid" for item in prompt_candidates) != 1:
            raise ValueError(
                f"Prompt {prompt['id']} must have exactly one SynthID candidate"
            )

        rng.shuffle(prompt_candidates)
        public_answers = []
        private_answers = []
        for label, candidate in zip(ANSWER_LABELS, prompt_candidates):
            public_answers.append({"id": label, "text": candidate["text"]})
            private_answers.append(
                {
                    "id": label,
                    "condition": candidate["condition"],
                    "generation_seed": candidate["generation_seed"],
                    "detector_evidence": candidate["detector_evidence"],
                }
            )

        public_questions.append(
            {
                "id": prompt["id"],
                "prompt": prompt["prompt"],
                "answers": public_answers,
            }
        )
        private_questions.append(
            {
                "id": prompt["id"],
                "watermarked_answer": next(
                    answer["id"]
                    for answer in private_answers
                    if answer["condition"] == "synthid"
                ),
                "answers": private_answers,
            }
        )

    public_quiz = {
        "title": "Can You Spot the Watermarked Text?",
        "instructions": (
            "Each question contains three answers from the same language model. "
            "Exactly one answer contains a SynthID text watermark."
        ),
        "model": model_name,
        "questions": public_questions,
    }
    answer_key = {
        "model": model_name,
        "quiz_seed": seed,
        "generation": generation_args,
        "watermark": watermark_config,
        "questions": private_questions,
    }
    return public_quiz, answer_key


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)
        file.write("\n")


def main() -> None:
    args = parse_args()
    prompts = load_prompts(args.prompts)
    watermark_keys = parse_watermark_keys(args.watermark_keys)
    device, dtype = select_device()

    print(f"Loading {args.model} on {device} with {dtype}...")
    tokenizer = AutoTokenizer.from_pretrained(
        args.model,
        padding_side="left",
    )
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id
    model_kwargs: dict[str, Any] = {
        "torch_dtype": dtype,
        "low_cpu_mem_usage": True,
    }
    if device.type == "cuda":
        model_kwargs["device_map"] = {"": device.index or 0}
    model = AutoModelForCausalLM.from_pretrained(args.model, **model_kwargs)
    if device.type != "cuda":
        model = model.to(device)
    model.eval()

    rendered_prompts = render_prompts(tokenizer, prompts)
    watermarking_config = SynthIDTextWatermarkingConfig(
        keys=watermark_keys,
        ngram_len=5,
    )
    generation_args = {
        "do_sample": True,
        "max_new_tokens": args.max_new_tokens,
        "min_new_tokens": args.min_new_tokens,
        "temperature": args.temperature,
        "top_p": args.top_p,
        "pad_token_id": tokenizer.pad_token_id,
    }
    conditions = ("synthid", "plain", "plain")
    candidates = {prompt["id"]: [] for prompt in prompts}
    detector_processor = watermarking_config.construct_processor(
        vocab_size=model.config.vocab_size,
        device=device,
    )

    for round_index, condition in enumerate(conditions):
        generation_seed = args.seed + round_index + 1
        print(
            f"Generating round {round_index + 1}/3 "
            f"({condition}, seed {generation_seed})..."
        )
        generated = generate_batch(
            model=model,
            tokenizer=tokenizer,
            device=device,
            rendered_prompts=rendered_prompts,
            generation_seed=generation_seed,
            generation_args=generation_args,
            watermarking_config=(
                watermarking_config if condition == "synthid" else None
            ),
        )
        for prompt, (text, token_ids) in zip(prompts, generated):
            candidates[prompt["id"]].append(
                {
                    "condition": condition,
                    "generation_seed": generation_seed,
                    "text": text,
                    "detector_evidence": detector_evidence(
                        token_ids=token_ids,
                        tokenizer=tokenizer,
                        processor=detector_processor,
                        device=device,
                        eos_token_id=tokenizer.eos_token_id,
                    ),
                }
            )

    watermark_config = {
        "type": "SynthIDTextWatermarkingConfig",
        "keys": watermark_keys,
        "ngram_len": 5,
        "sampling_table_seed": watermarking_config.sampling_table_seed,
        "sampling_table_size": watermarking_config.sampling_table_size,
        "context_history_size": watermarking_config.context_history_size,
    }
    public_quiz, answer_key = assemble_outputs(
        prompts=prompts,
        candidates=candidates,
        model_name=args.model,
        generation_args=generation_args,
        seed=args.seed,
        watermark_config=watermark_config,
    )

    quiz_path = args.output_dir / "quiz.json"
    key_path = args.output_dir / "answer-key.json"
    write_json(quiz_path, public_quiz)
    write_json(key_path, answer_key)
    print(f"Wrote public quiz to {quiz_path}")
    print(f"Wrote private answer key and SynthID keys to {key_path}")


if __name__ == "__main__":
    main()
