"use strict";

// Debug logging is enabled by default while testing.
// Set chat_censor.debug=false in config.json to silence it.

function hexPreview(buffer, maxBytes = 96) {
    return buffer.subarray(0, maxBytes).toString("hex");
}

function textPreview(buffer, maxBytes = 160) {
    return buffer
        .subarray(0, maxBytes)
        .toString("latin1")
        .replace(/[^\x20-\x7e]/g, ".");
}

function censorPayload(payload, censor) {
    const debug = Boolean(censor && censor.debug === true);

    if (!Buffer.isBuffer(payload)) {
        if (debug) console.log("[chat-censor] SKIP: payload is not Buffer");
        return payload;
    }

    if (!censor) {
        if (debug) console.log("[chat-censor] SKIP: censor config missing");
        return payload;
    }

    if (censor.enabled !== true) {
        if (debug) console.log("[chat-censor] SKIP: censor disabled");
        return payload;
    }

    if (!Array.isArray(censor.patterns)) {
        if (debug) console.log("[chat-censor] SKIP: patterns is not an array");
        return payload;
    }

    if (debug) {
        console.log(`[chat-censor] CHECK packet length=${payload.length}`);
        console.log(`[chat-censor] HEX: ${hexPreview(payload)}`);
        console.log(`[chat-censor] TEXT: ${textPreview(payload)}`);
        console.log(`[chat-censor] patterns=${censor.patterns.length}`);
    }

    // 1:1 byte-to-character mapping. This allows ASCII chat text embedded
    // inside binary PDP/PTP payloads to be inspected without changing size.
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
            console.error(`[chat-censor] INVALID REGEX: ${source}`,
                error.message);
            continue;
        }

        const before = data;
        data = data.replace(expression, (match) => {
            if (match.length === 0) {
                return match;
            }

            changed = true;
            if (debug) {
                console.log(`[chat-censor] MATCH regex=${source} match=${JSON.stringify(match)}`);
            }

            return replacement.repeat(match.length);
        });

        if (debug && before !== data) {
            console.log(`[chat-censor] REPLACED regex=${source}`);
        }
    }

    if (!changed) {
        if (debug) console.log("[chat-censor] NO MATCH");
        return payload;
    }

    if (debug) {
        console.log(`[chat-censor] CENSORED: ${textPreview(Buffer.from(data, "latin1"))}`);
    }

    if (censor.mode === "drop") {
        if (debug) console.log("[chat-censor] ACTION: DROP PACKET");
        return null;
    }

    if (debug) console.log("[chat-censor] ACTION: MASK PACKET");
    return Buffer.from(data, "latin1");
}

module.exports = {
    censorPayload,
};
