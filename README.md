# Watermark quiz

This repository contains a static, ten-question quiz and the generator used to
produce its source dataset. In every question, all three answers come from
`Qwen/Qwen3-30B-A3B-Instruct-2507`; exactly one was generated with SynthID Text
watermarking.

## Preview the site locally

The site has no build step or external dependencies. From the repository root:

```bash
python -m http.server 8000 -d site
```

Then open <http://localhost:8000>. If your system exposes Python as `python3`,
use that command instead.

Quiz progress is saved in the browser's local storage. The answer review shows
only the correct label, weighted mean detector scores, and three high-scoring
token contexts per response. These scores are aggregate diagnostics, not
calibrated probabilities.

On submission, the browser redirects to a score-specific path from `/0/`
through `/10/`. Umami records those pageviews using the site configured in
`site/index.html` and the generated score pages. Aggregate path counts provide
a lightweight score distribution; shared score links may also add pageviews.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` deploys on pushes to `main` and
can also be run manually. In the repository's **Settings → Pages**, choose
**GitHub Actions** as the source. The upload step is explicitly scoped to
`site/`; private generated files under `output/` are never included in the
Pages artifact.

## Project structure

```text
site/                       Static GitHub Pages site
  data/quiz.json            Public prompts and responses
  data/results.json         Minimal scoring and review data
output/                     Private/local generated output (gitignored)
tests/                      Generator and public-data consistency tests
generate_quiz.py            Dataset generator
annotate_detector_tokens.py Detector annotation utility
prepare_site_data.py        Public-data sanitizer and score-page generator
prompts.json                Source prompts
```

`site/data/results.json` necessarily makes the correct labels public for
client-side scoring. It intentionally excludes watermark keys, generation
seeds, condition fields, sampling configuration, and other private metadata.
Regenerate the publishable data and score routes with:

```bash
uv run python prepare_site_data.py
```

## Generate the dataset

Install the dependencies and run the generator:

```bash
uv sync
uv run python generate_quiz.py
```

The default model is intended for a rented H200-class GPU. It uses about 61 GB
for BF16 model weights, leaving ample room for batched generation and SynthID's
logits processing. Generation produces 30 answers targeting 120–160 words each.

The command writes:

- `output/quiz.json`: public prompts and randomized answers.
- `output/answer-key.json`: private labels, generation seeds, detector scores,
  top detector-contributing token positions, and SynthID keys.

Do not publish `answer-key.json` before collecting quiz responses. The entire
`output/` directory is ignored by Git.

## Customize the experiment

Edit `prompts.json` while keeping exactly ten entries, or override generation
settings:

```bash
uv run python generate_quiz.py \
  --temperature 0.8 \
  --top-p 0.9 \
  --min-new-tokens 100 \
  --max-new-tokens 240
```

For a smaller local smoke test, override the model:

```bash
uv run python generate_quiz.py --model Qwen/Qwen3-4B-Instruct-2507
```

By default, the generator creates 30 private SynthID keys. To reproduce an
existing run, reuse the `quiz_seed` and `watermark.keys` values from the private
answer key:

```bash
uv run python generate_quiz.py \
  --seed 20260820 \
  --watermark-keys 123,456,789
```

The weighted-mean detector score is recorded as a sanity check, not shown to
quiz participants, and not treated as a calibrated binary classification.
Each private answer also records its ten highest-contributing scored n-grams,
including the ending token, context text, weighted g-value score, and raw
g-value hit count. These positions are diagnostics; the watermark is detected
from the aggregate distribution rather than from any individual word.
