/**
 * Voice controls, Node half. The empty apply keeps the browser-only feature in
 * the Loader roster; `@deepseek-ai/dsh-speech-web` owns the Host transport.
 */

/** Host plugin body — this package contributes only browser presentation. */
export function apply(): void {}
