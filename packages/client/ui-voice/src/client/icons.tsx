/** Private voice-control icons; the shared icon catalog owns no microphone or speaker glyph. */

/** Telephone handset. */
export function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
    <path d="M5 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z" fill="currentColor" />
  </svg>
}

/** Microphone outline. */
export function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
      <rect x="5.25" y="1.5" width="5.5" height="8" rx="2.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 7.75a4.5 4.5 0 0 0 9 0M8 12.25V14.5M5.75 14.5h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Speaker with two sound waves. */
export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
      <path d="M2 6h2.25L7.5 3.5v9L4.25 10H2V6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.75 6a3 3 0 0 1 0 4M11.75 4.25a5.25 5.25 0 0 1 0 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Compact stop square used while recording or playing. */
export function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="2.5" fill="currentColor" />
    </svg>
  )
}
