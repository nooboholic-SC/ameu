"use strict";

/**
 * Censors ASCII text in a complete application payload without changing
 * the payload length. This makes mask mode safe for binary protocols that
 * carry fixed-size/text fields.
 *
 * Matching is deliberately limited to text-like payloads so random binary
 * game packets are not treated as chat.
 */
function isTextLike(payload) {
    if (!Buffer.isBuffer(payload) || payload.length < 4) {
        return false;
    }

    let textBytes = 0;
    for (const byte of payload) {
        if ((byte >= 0x20 && byte <= 0x7e) ||
            byte === 0x09 || byte === 0x0a || byte === 0x0d) {
            textBytes++;
        }
    }

    return (textBytes / payload.length) >= 0.75;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");
}

function censorPayload(payload, censor) {
    if (!isTextLike(payload) ||
        !censor ||
        censor.enabled !== true ||
        !Array.isArray(censor.words)) {
        return payload;
    }

    let data = payload.toString("latin1");
    let changed = false;
    const replacement = (typeof censor.replacement === "string" &&
        censor.replacement.length > 0)
        ? censor.replacement[0]
        : "*";

    for (const configuredWord of censor.words) {
        if (typeof configuredWord !== "string") {
            continue;
        }

        const word = configuredWord.trim();
        if (word.length === 0) {
            continue;
        }

        const expression = new RegExp(
            "(^|[^A-Za-z0-9])" +
            escapeRegExp(word) +
            "([^A-Za-z0-9]|$)",
            "giu"
        );

        const next = data.replace(
            expression,
            (match) => {
                changed = true;
                return replacement.repeat(match.length);
            }
        );

        data = next;
    }

    if (!changed) {
        return payload;
    }

    if (censor.mode === "drop") {
        return null;
    }

    return Buffer.from(data, "latin1");
}

module.exports = {
    censorPayload,
};
