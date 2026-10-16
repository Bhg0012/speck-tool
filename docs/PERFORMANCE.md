# Performance notes

Measured 2026-10-16 with real Ollama 0.40.5 and a Retina-size quiz screenshot
(CPU-only test machine; Apple Silicon is roughly 10-20x faster at generation).

## Why v1.0 took minutes ("reading..." forever)
| Cause | Effect |
| --- | --- |
| `qwen3-vl:8b` is the **thinking** variant | Writes hidden reasoning even with `think: false` (~250 extra tokens per call); full-length reasoning when thinking is on |
| 3-4 calls per question (read, solve, verify, tie-break), solve/verify with thinking on | Thousands of generated tokens per question |
| Different `num_ctx` per call (warm-up default, 12288, 16384) | Ollama **reloads the 6 GB model** whenever num_ctx changes |
| 1600 px images | ~1,600 image tokens per call |

The reader call alone hit the 5-minute timeout on the test machine.

## v1.1 design
- Default model `qwen3-vl:8b-instruct` (same size, no hidden reasoning).
- Each attempt answers straight from the screenshot as JSON, with short visible working (max 4 steps)
  and an answer. About 190 generated tokens.
- Careful mode = 2 independent attempts (+1 tie-break only on disagreement).
- Same system prompt + image first in every attempt, so Ollama reuses the processed image.
- One `num_ctx` (4096) for every call **including the warm-up**: no reloads.
- Images capped at 1280 px (~800-1,600 tokens). Retina text stays sharp.
- 2-minute per-call timeout with a clear message instead of an endless spinner.

## Results (CPU test machine)
| | Calls | Generated tokens | Answer |
| --- | --- | --- | --- |
| v1.0, careful | read call alone timed out (>300 s) | 372+ for read only | none |
| v1.1, careful, markup/discount question | 2 | 220 + 283 | $84.00, 10/10 |
| v1.1, careful, tank question (trimmed prompt) | 2 | 183 + 199 | C) 75, 10/10 |

Estimated on an M-series MacBook (~25-30 tokens/s for an 8B Q4 model): **~15-20 s careful,
~8 s fast**. `qwen3-vl:4b-instruct` roughly halves that.
