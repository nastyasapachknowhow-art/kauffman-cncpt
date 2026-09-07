h2. Summary

The chat widget can become stuck in a persistent “still processing” loop when it receives either a message with an embedded literal newline or several messages sent back-to-back. Transcript entries may also be concatenated or garbled. This is a reproducible, user-facing functional reliability issue; no security impact was identified.

h2. Steps to reproduce

# Preconditions: The chat widget is available and able to accept messages.
# Reproduction path A: Send a message containing an embedded literal newline character (for example, pasted multi-line text or the message used in test 3.2 via automation tooling).
# Observe the transcript and widget response.
# Reproduction path B: In a separate attempt, send {{message one}}, {{message two}}, and {{message three}} back-to-back with no delay.
# Observe the transcript and widget response.

h2. Expected result

Each submitted message is preserved as its own transcript entry, including newline formatting where applicable. The widget should queue and answer accepted messages in order, or explicitly prevent additional sends while a request is in flight. If a request stalls or fails, it should self-recover and display a clear, actionable error or retry option.

h2. Actual result

In both reproduction paths, the widget concatenated or garbled the messages in the transcript. For example, {{message onemessage twomessage three}} appeared merged into fewer bubbles than were sent, with no spacing between words.

The widget then repeatedly displayed: {{Please wait, I am still processing your previous request.}} No substantive answer was returned during at least 8–14 seconds of observation, and the widget did not self-recover in that window. It recovered only after a subsequent, separate message such as {{hello?}} or {{are you there?}} was sent, after which it replied normally.

h2. Additional info

* Reproducibility: Confirmed twice independently—once with a raw newline and once with three rapid sequential sends.
* Impact: Users pasting multi-line content (such as a copied email or detailed question), or sending a follow-up before the first reply arrives, can be left in an apparently indefinite processing state with no visible recovery path. Their input may be visually corrupted or lost.
* Recommendation: Review the message queue and processing-state logic. Preserve message boundaries and literal newlines; serialize accepted messages or clearly block further sends while processing; and add timeout/state-reset handling so a stalled state recovers without requiring another message.
* Verdict: Fail — reproducible functional defect.
