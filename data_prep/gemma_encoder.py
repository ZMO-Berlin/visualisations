"""Local EmbeddingGemma 2 text encoder for the thematic map.

Runs the published ONNX export of ``google/embeddinggemma-2`` in fp32 with
onnxruntime and the model's own ``tokenizer.json``: no torch, no API key, and
the pinned revisions below let anyone recompute the vectors offline. It is the
text half of the encoder the IWAC pipeline uses (``IWAC-Hugging-Face``
``post-processing/_gemma_encoder.py``), with the same revisions, so the two
projects' vectors come from one model build.

The model card forbids float16 (activations overflow it), so only the fp32
graph is used. Every vector returned is L2-normalised.

Only ``build_themes.py`` imports this, and only when it has to embed something:
the dashboard generator and CI read the committed ``raw_data/themes.json`` and
never need the model, onnxruntime or tokenizers.
"""

from __future__ import annotations

from typing import Iterator, List, Sequence

import numpy as np

MODEL_ID = "google/embeddinggemma-2"
MODEL_REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
ONNX_ID = "onnx-community/embeddinggemma-2-ONNX"
ONNX_REVISION = "daa72c51243991dfcaf9f9137d2c573d8f7790c0"
DIMENSION = 768
MAX_TOKENS = 8192

# The model card's symmetric prefix for clustering: every input gets the same
# one, unlike retrieval, where queries and documents differ.
CLUSTERING_PREFIX = "task: clustering | query: "

# Padded tokens per onnxruntime call. Batches are grouped shortest-first so a
# batch of titles is not padded out to the length of one long abstract.
TOKEN_BUDGET = 8192


def clustering_text(content: str) -> str:
    return CLUSTERING_PREFIX + content


def model_settings() -> dict:
    """Identity of the vector space, recorded in the output for provenance.

    Library versions are deliberately absent: they do not change fp32 outputs
    beyond float noise. The model and export revisions are what keep two vector
    spaces from being mixed.
    """
    return {
        "model": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "onnx_export": f"{ONNX_ID}@{ONNX_REVISION}",
        "runtime": "onnxruntime",
        "precision": "fp32",
        "dimension": DIMENSION,
        "prefix": CLUSTERING_PREFIX,
    }


def validate_vectors(vectors: np.ndarray, expected_count: int) -> np.ndarray:
    """Reject a whole batch whose shape or values could be silently wrong."""
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.shape != (expected_count, DIMENSION):
        raise ValueError(f"encoder returned shape {vectors.shape}, expected ({expected_count}, {DIMENSION})")
    if not np.isfinite(vectors).all():
        raise ValueError("encoder returned a non-finite value")
    if not np.abs(vectors).sum(axis=1).all():
        raise ValueError("encoder returned an all-zero vector")
    return vectors


def token_batches(lengths: Sequence[int], budget: int = TOKEN_BUDGET) -> Iterator[List[int]]:
    """Indices grouped shortest-first so a batch's padded size stays within ``budget``."""
    batch: List[int] = []
    longest = 0
    for index in sorted(range(len(lengths)), key=lambda i: (lengths[i], i)):
        size = lengths[index]
        if batch and max(longest, size) * (len(batch) + 1) > budget:
            yield batch
            batch, longest = [], 0
        batch.append(index)
        longest = max(longest, size)
    if batch:
        yield batch


class GemmaEncoder:
    """An fp32 ONNX text session at the pinned revisions."""

    def __init__(self, *, threads: int | None = None, token: str | None = None):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        def fetch(name: str) -> str:
            return hf_hub_download(ONNX_ID, name, revision=ONNX_REVISION, token=token)

        self.tokenizer = Tokenizer.from_file(fetch("tokenizer.json"))
        # Same as transformers' truncation=True: specials (BOS/EOS) are kept.
        self.tokenizer.enable_truncation(MAX_TOKENS)
        self.pad_id = self.tokenizer.token_to_id("<pad>")

        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        path = fetch("onnx/model.onnx")
        fetch("onnx/model.onnx_data")
        self.session = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])
        feature_dim = {i.name: i.shape for i in self.session.get_inputs()}["image_features"][-1]
        self.no_features = np.zeros((0, feature_dim), np.float32)

    def token_lengths(self, texts: Sequence[str]) -> List[int]:
        return [len(encoding.ids) for encoding in self.tokenizer.encode_batch(list(texts))]

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        """Unit vectors for already-formatted texts (see ``clustering_text``)."""
        encodings = self.tokenizer.encode_batch(list(texts))
        width = max(len(e.ids) for e in encodings)
        input_ids = np.full((len(encodings), width), self.pad_id, np.int64)
        attention_mask = np.zeros((len(encodings), width), np.int64)
        for row, encoding in enumerate(encodings):  # right padding, as the tokenizer config says
            input_ids[row, :len(encoding.ids)] = encoding.ids
            attention_mask[row, :len(encoding.ids)] = 1
        feed = {"input_ids": input_ids, "attention_mask": attention_mask,
                "image_features": self.no_features, "video_features": self.no_features,
                "audio_features": self.no_features}
        vectors = self.session.run(["sentence_embedding"], feed)[0]
        return validate_vectors(vectors, len(texts))

    def encode_all(self, texts: Sequence[str], progress=None) -> np.ndarray:
        """Every text, batched by length; rows come back in input order."""
        out = np.zeros((len(texts), DIMENSION), np.float32)
        done = 0
        for batch in token_batches(self.token_lengths(texts)):
            out[batch] = self.encode([texts[i] for i in batch])
            done += len(batch)
            if progress:
                progress(done, len(texts))
        return out
