"use strict";

/**
 * Censors regex matches inside an application payload without changing
 * payload length. Chat packets can contain binary framing around the text,
 * so the whole-payload 75% text heuristic is intentionally not used here.
 *
 * config.chat_censor.patterns contains JavaScript regex source strings.
 */
function censorPayload(payload, censor) {
    if (!Buffer.isBuffer(payload) ||
        !censor ||
        censor.enabled !== true ||
        !Array.isArray(censor.patterns)) {
        return payload;
    }

    // latin1 gives a 1:1 byte-to-character mapping. That lets us search
    // ASCII chat text embedded in a binary PDP/PTP payload while preserving
    // the exact packet length.
    let data = payload.toString("latin1");
    let changed = false;
    const replacement = (typeof censor.replacement === "string" &&
        censor.replacement.length > 0)
        ? censor.replacement[0]
        : "*";

    for (const source of censor.patterns) {
        if (typeof source !== "string" || source.length === 0) {
            continue;
        }

        let expression;
        try {
            expression = new RegExp(source, "gi");
        }
        catch (error) {
            console.error(`[chat-censor] Invalid regex: ${source}`, error.message);
            continue;
        }

        data = data.replace(expression, (match) => {
            // Avoid touching empty matches from patterns such as ($|).
            if (match.length === 0) {
                return match;
            }
            changed = true;
            return replacement.repeat(match.length);
        });
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
