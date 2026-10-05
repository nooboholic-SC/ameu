"use strict";

/**
 * Generic payload chat censor.
 *
 * This helper intentionally does not assume a game-specific chat packet layout.
 * It censors UTF-8 text in a complete application payload.
 *
 * config:
 *   enabled: boolean
 *   mode: "replace" | "drop"
 *   replacement: string
 *   words: string[]
 */

function normalizeForMatch(text) {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\\p{L}\\p{N}]+/gu, "");
}

function isConfigured(censor) {
    return Boolean(
        censor &&
        censor.enabled === true &&
        Array.isArray(censor.words) &&
        censor.words.length > 0
    );
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");
}

function censorUtf8Payload(payload, censor) {
    if (!Buffer.isBuffer(payload) || !isConfigured(censor)) {
        return payload;
    }

    const original = payload.toString("utf8");
    const normalized = normalizeForMatch(original);
    const words = censor.words
        .filter((word) => typeof word === "string" && word.trim().length > 0)
        .map((word) => normalizeForMatch(word))
        .filter((word) => word.length > 0);

    if (words.length === 0) {
        return payload;
    }

    const matched = words.some((word) => normalized.includes(word));
    if (!matched) {
        return payload;
    }

    if (censor.mode === "drop") {
        return null;
    }

    const replacement = typeof censor.replacement === "string"
        ? censor.replacement
        : "***";

    let result = original;

    for (const word of censor.words) {
        if (typeof word !== "string" || word.trim().length === 0) {
            continue;
        }

        result = result.replace(
            new RegExp(escapeRegExp(word), "giu"),
            replacement
        );

        const chars = Array.from(word.normalize("NFKC"))
            .filter((ch) => /[\\p{L}\\p{N}]/u.test(ch));

        if (chars.length > 0) {
            const obfuscated = chars
                .map(escapeRegExp)
                .join("[^\\p{L}\\p{N}]*");

            result = result.replace(
                new RegExp(obfuscated, "giu"),
                replacement
            );
        }
    }

    return Buffer.from(result, "utf8");
}

module.exports = {
    censorUtf8Payload,
    isConfigured,
};
