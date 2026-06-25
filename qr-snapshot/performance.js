/**
 * @file performance.js
 * @description Native OpenAI preset-switching performance optimizer for Zero extension.
 *
 * HOW IT WORKS
 * ────────────
 * SillyTavern's onSettingsPresetChange() does two expensive things on every
 * preset switch, regardless of whether anything actually changed:
 *
 *   1. Fires ~100 synchronous trigger('input', {source:'preset'}) calls — one
 *      per setting in settingsToUpdate — causing layout thrashing.
 *
 *   2. When bind_preset_to_connection is on, calls
 *      $('#chat_completion_source').trigger('change') unconditionally, which
 *      triggers reconnectOpenAi() → a real HTTP API connection test — even
 *      when the user is switching between two presets that use the same
 *      API provider.
 *
 * SOLUTION (zero native file changes)
 * ─────────────────────────────────────
 * We leverage the OAI_PRESET_CHANGED_BEFORE / OAI_PRESET_CHANGED_AFTER events.
 * Because eventSource.emit() is async and awaits every listener in order, our
 * BEFORE listener completes BEFORE the .finally() callback (which contains all
 * the expensive work) runs.
 *
 * During the switch window we temporarily replace $.fn.trigger with a thin
 * interceptor that:
 *   • Skips #chat_completion_source change if source value hasn't changed
 *     (prevents reconnect).
 *   • Collects trigger('input', {source:'preset'}) targets instead of firing
 *     them synchronously, then flushes them all in one requestAnimationFrame
 *     after the switch (prevents layout thrashing).
 *
 * Outside the switch window the interceptor is not installed, so there is
 * NO overhead on any other jQuery trigger calls.
 */

// ─── Module-level state ───────────────────────────────────────────────────────

/** True only while a preset switch is in progress. */
let _switching = false;

/** The chat_completion_source value BEFORE the preset loop ran. */
let _prevSource = '';

/** Elements whose 'input' events were deferred during the switch. */
const _pendingInputEls = new Set();

/** Original $.fn.trigger, saved while the patch is active. */
let _origTrigger = null;

/** Safety-valve timer handle — restores the patch if AFTER never fires. */
let _safetyTimer = null;

const SAFETY_MS = 10_000; // 10 s

// ─── Patched trigger ──────────────────────────────────────────────────────────

/**
 * Replacement for $.fn.trigger, active only during a preset switch.
 * Hot path: the very first check (`!_switching`) makes the non-switching case
 * a single boolean test + function call — effectively zero overhead.
 *
 * @this {JQuery}
 * @param {string|jQuery.Event} eventType
 * @param {*} [extraParameters]
 * @returns {JQuery}
 */
function _patchedTrigger(eventType, extraParameters) {
    // ── Fast path: not switching → behave exactly like the original ──
    if (!_switching) {
        return _origTrigger.apply(this, arguments);
    }

    const el = this[0];

    // ── Optimization 1: suppress chat_completion_source change when source
    //    value hasn't actually changed (prevents reconnectOpenAi() HTTP call) ──
    if (eventType === 'change' && el?.id === 'chat_completion_source') {
        const newSource = String(el.value ?? '');
        if (_prevSource === newSource) {
            // Source is unchanged → silently drop; reconnect is unnecessary.
            return this;
        }
        // Source genuinely changed → pass through for normal reconnect.
        return _origTrigger.apply(this, arguments);
    }

    // ── Optimization 2: defer trigger('input', {source:'preset'}) calls ──
    //    ~100 of these fire synchronously during a preset load.  Collecting
    //    them and replaying in rAF lets the browser batch layout/paint.
    if (eventType === 'input' && extraParameters?.source === 'preset') {
        if (el) _pendingInputEls.add(el);
        return this; // deferred
    }

    // All other triggers pass through without modification.
    return _origTrigger.apply(this, arguments);
}

// ─── Install / uninstall helpers ─────────────────────────────────────────────

function _install(prevSource) {
    _switching = true;
    _prevSource = prevSource;
    _pendingInputEls.clear();

    if (!_origTrigger) {
        _origTrigger = $.fn.trigger;
        $.fn.trigger = _patchedTrigger;
    }

    // Safety valve: if AFTER event never fires (e.g. an error in openai.js),
    // restore the original trigger after SAFETY_MS so we don't permanently
    // break jQuery triggers.
    clearTimeout(_safetyTimer);
    _safetyTimer = setTimeout(_restore, SAFETY_MS);
}

function _restore() {
    clearTimeout(_safetyTimer);
    _safetyTimer = null;
    _switching = false;
    _prevSource = '';

    if (_origTrigger) {
        $.fn.trigger = _origTrigger;
        _origTrigger = null;
    }
}

/**
 * Flush all deferred input events in the next animation frame.
 * By this point $.fn.trigger has already been restored to the original, so
 * there is no risk of recursive patching.
 */
function _flush() {
    if (_pendingInputEls.size === 0) return;

    const pending = [..._pendingInputEls];
    _pendingInputEls.clear();

    requestAnimationFrame(() => {
        for (const el of pending) {
            // Guard: element might have been removed from DOM during the switch.
            if (el?.isConnected) {
                // $.fn.trigger is now the original — no special-casing needed.
                $(el).trigger('input', { source: 'preset' });
            }
        }
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call once from the extension entry point (after APP_READY) to activate the
 * preset-switch optimizer.
 *
 * @param {object} eventSource  SillyTavern's global eventSource
 * @param {object} event_types  SillyTavern's event_types constants
 */
export function initPresetPerformanceOptimizer(eventSource, event_types) {
    if (!eventSource || !event_types?.OAI_PRESET_CHANGED_BEFORE) {
        console.warn('[Zero Perf] Required events unavailable — optimizer not installed');
        return;
    }

    // BEFORE the .finally() callback runs: install the patch.
    // eventSource.emit() is async and awaits every listener, so our handler
    // completes before the expensive work starts.
    eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, (data) => {
        const prevSource = String(data?.settings?.chat_completion_source ?? '');
        _install(prevSource);
    });

    // AFTER all preset work is done: restore, then flush deferred events.
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
        _restore();
        _flush();
    });

    console.log('[Zero Perf] Preset switch optimizer ready ✓');
}
