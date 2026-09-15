/** Continuous echo-cancelled microphone capture; processing stays off the UI thread. */

// The wire protocol is mono PCM16 at 16 kHz in 100 ms frames. AudioContext performs resampling.
const PROCESSOR = `class CallPcm extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(1600); this.offset = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const value of channel) {
      const sample = Math.max(-1, Math.min(1, value));
      this.samples[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.offset === 1600) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('call-pcm', CallPcm);`

/**
 * Start continuous PCM capture.
 * @param onFrame - ordered 100 ms frames.
 * @param microphone - browser input processing selected by the Host.
 * @param signal - microphone lifetime.
 * @returns asynchronous resource cleanup.
 */
export async function capturePcm(
  onFrame: (pcm: Uint8Array) => void,
  microphone: { readonly echoCancellation: boolean; readonly noiseSuppression: boolean; readonly autoGainControl: boolean },
  signal: AbortSignal,
): Promise<{ close(): Promise<void> }> {
  signal.throwIfAborted()
  const audio = new AudioContext({ sampleRate: 16000 })
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }))
  let stream: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let closed: Promise<void> | undefined
  const close = (): Promise<void> => {
    stream?.getTracks().forEach((track) => { if (track.readyState !== 'ended') track.stop() })
    if (closed !== undefined) return closed
    signal.removeEventListener('abort', abort)
    node?.port.close()
    node?.disconnect()
    source?.disconnect()
    URL.revokeObjectURL(url)
    closed = audio.close()
    return closed
  }
  const abort = (): void => { void close() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (audio.sampleRate !== 16000) throw new Error('The browser does not support 16 kHz voice capture')
    // Permission may remain pending after hangup; its eventual stream must never survive the call.
    const permission = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, ...microphone },
    })
    void permission.then((value) => { if (signal.aborted) value.getTracks().forEach((track) =>{  track.stop() }) }, () => {})
    let removeAbort = (): void => {}
    try {
      stream = await Promise.race([permission, new Promise<never>((_, reject) => {
        const cancel = (): void => { reject(new DOMException('Call ended', 'AbortError')) }
        signal.addEventListener('abort', cancel, { once: true })
        removeAbort = () => { signal.removeEventListener('abort', cancel) }
        if (signal.aborted) cancel()
      })])
    } finally { removeAbort() }
    signal.throwIfAborted()
    await audio.audioWorklet.addModule(url)
    signal.throwIfAborted()
    source = audio.createMediaStreamSource(stream)
    node = new AudioWorkletNode(audio, 'call-pcm')
    node.port.onmessage = (message: MessageEvent<ArrayBuffer>) => { if (!signal.aborted) onFrame(new Uint8Array(message.data)) }
    source.connect(node)
    node.connect(audio.destination) // The processor emits silence while forwarding microphone input through its port.
    await audio.resume()
    signal.throwIfAborted()
    return { close }
  } catch (error) { await close(); throw error }
}
