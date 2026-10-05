"use strict";

/**
 * Censors ASCII text in a complete application payload without changing
 * the payload length. Regex patterns are used so obfuscated spellings such
 * as "f u c k" and "fcuk" can be matched.
 *
 * config.chat_censor.patterns contains JavaScript regex source strings.
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

function censorPayload(payload, censor) {
    if (!isTextLike(payload) ||
        !censor ||
        censor.enabled !== true ||
        !Array.isArray(censor.patterns)) {
        return payload;
    }

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
            changed = true;
            // Keep the exact byte length so fixed-size/binary framing is safe.
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
