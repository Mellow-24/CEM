/** Call-local text history; accepted prompts remain durable in the ordinary Session. */

/** One stable row in the current call, including text that has not been spoken. */
export interface CallTranscriptEntry {
  readonly id: string
  readonly speaker: 'user' | 'assistant'
  readonly text: string
  readonly status: 'partial' | 'complete' | 'interrupted' | 'unsubmitted'
}

/** Retain the greeting, recognizer drafts, and generated replies across interruptions. */
export class CallTranscript {
  private rows: readonly CallTranscriptEntry[] = []
  private serial = 0
  private draft: string | undefined
  private readonly replyIds = new Set<string>()

  /**
   * Current call text in display order.
   * @returns immutable, identity-stable rows until a text or status update.
   */
  get entries(): readonly CallTranscriptEntry[] { return this.rows }

  /**
   * Begin a fresh call.
   * @param greeting - prepared opening text, not a model message.
   */
  start(greeting: string): void {
    this.rows = [{ id: 'greeting', speaker: 'assistant', text: greeting, status: 'complete' }]
    this.serial = 0
    this.draft = undefined
    this.replyIds.clear()
  }

  /**
   * Update one recognizer draft across partial and final segments.
   * @param text - accumulated caller text.
   */
  recognize(text: string): void {
    if (text.trim() === '') return
    this.draft ??= `user:${String(++this.serial)}`
    this.write({ id: this.draft, speaker: 'user', text, status: 'partial' })
  }

  /**
   * Finish the draft without deleting it.
   * @param submitted - whether the text entered the submission queue.
   */
  finishUtterance(submitted: boolean): void {
    if (this.draft === undefined) return
    const id = this.draft
    this.rows = this.rows.map(row => row.id === id ? { ...row, status: submitted ? 'complete' : 'unsubmitted' } : row)
    this.draft = undefined
  }

  /** Remove the current recognizer draft after it is classified as echo or a passive acknowledgement. */
  discardUtterance(): void {
    if (this.draft === undefined) return
    const id = this.draft
    this.rows = this.rows.filter(row => row.id !== id)
    this.draft = undefined
  }

  /** Begin tracking the next answer's generated rows. */
  beginReply(): void { this.replyIds.clear() }

  /**
   * Publish generated text without waiting for audio.
   * @param id - call-local turn and step identifier.
   * @param text - visible assistant text with reasoning excluded.
   * @param complete - whether the model committed this text.
   */
  answer(id: string, text: string, complete: boolean): void {
    if (text === '') return
    this.replyIds.add(id)
    this.write({ id, speaker: 'assistant', text, status: complete ? 'complete' : 'partial' })
  }

  /** Mark only the current answer as interrupted; retain its generated text. */
  interrupt(): void {
    this.rows = this.rows.map(row => this.replyIds.has(row.id) ? { ...row, status: 'interrupted' } : row)
    this.replyIds.clear()
  }

  private write(entry: CallTranscriptEntry): void {
    const previous = this.rows.find(row => row.id === entry.id)
    if (previous?.text === entry.text && previous.status === entry.status) return
    this.rows = previous === undefined ? [...this.rows, entry] : this.rows.map(row => row.id === entry.id ? entry : row)
  }
}
