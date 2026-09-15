/** `voice` namespace dictionaries for microphone, send, and playback controls. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'call.live': '实时语音 · AI 客服',
  'call.start': '开始语音通话',
  'call.title': '客服语音通话',
  'call.end': '挂断通话',
  'call.idle': '通话已结束',
  'call.connecting': '正在连接…',
  'call.listening': '正在听，请说出您的问题',
  'call.transcribing': '正在识别语音…',
  'call.thinking': '客服正在查询并回答…',
  'call.generating': '正在生成语音…',
  'call.playing': '客服正在回答…',
  'call.ending': '正在结束通话…',
  'call.error': '通话遇到问题',
  'call.hint': '开场白结束后即可提问，客服回答时可随时打断',
  'call.you': '您',
  'call.assistant': '客服',
  'call.finish': '说完了，发送本句',
  'call.skip': '停止播报，继续说话',
  'call.saved': '已提交的问答保留在当前聊天记录中',

  'input.start': '开始录音',
  'input.stop': '停止录音',
  'input.requesting': '正在请求麦克风权限',
  'input.transcribing': '正在转写语音',
  'input.cancel': '取消语音输入',
  'input.voiceSend': '语音发送',
  'input.transcriptSend': '发送转写',
  'input.running': '等待当前回复完成后再使用语音',
  'status.recording': '正在录音。点击麦克风停止并转写。',
  'status.transcribing': '正在转写语音…',
  'status.voiceDraft': '转写已加入草稿。编辑后普通发送，或点击“语音发送”并自动播放下一条回复的 AI 合成语音。',
  'status.transcriptDraft': '转写已加入草稿。可编辑后普通发送，或点击“发送转写”。',
  'status.awaitingReply': '已语音发送，等待下一条回复的 AI 合成语音。',
  'status.generating': '正在生成 AI 合成语音…',
  'status.playing': '正在播放 AI 合成语音。',
  'status.profileError': '无法加载语音功能：{message}',
  'status.inputError': '语音输入失败：{message}',
  'status.playbackError': 'AI 合成语音播放失败：{message}',
  'playback.play': '播放 AI 合成语音',
  'playback.stop': '停止 AI 合成语音',
  'playback.retry': 'AI 合成语音播放失败，点击重试',
} satisfies Record<string, string>

/** Voice control namespace key union. */
export type VoiceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'call.live': 'LIVE · AI CUSTOMER SERVICE',
  'call.start': 'Start voice call',
  'call.title': 'Customer service voice call',
  'call.end': 'End call',
  'call.idle': 'Call ended',
  'call.connecting': 'Connecting…',
  'call.listening': 'Listening. What can we help with?',
  'call.transcribing': 'Transcribing…',
  'call.thinking': 'Looking up your question…',
  'call.generating': 'Preparing speech…',
  'call.playing': 'Speaking…',
  'call.ending': 'Ending call…',
  'call.error': 'Call error',
  'call.hint': 'Speak after the greeting. You can interrupt any answer.',
  'call.you': 'You',
  'call.assistant': 'Assistant',
  'call.finish': 'Send this utterance',
  'call.skip': 'Stop playback and listen',
  'call.saved': 'Submitted messages stay in this conversation',

  'input.start': 'Start recording',
  'input.stop': 'Stop recording',
  'input.requesting': 'Requesting microphone access',
  'input.transcribing': 'Transcribing speech',
  'input.cancel': 'Cancel voice input',
  'input.voiceSend': 'Voice send',
  'input.transcriptSend': 'Send transcript',
  'input.running': 'Wait for the current response before using voice',
  'status.recording': 'Recording. Select the microphone to stop and transcribe.',
  'status.transcribing': 'Transcribing speech…',
  'status.voiceDraft': 'The transcript is in the draft. Edit and send normally, or select Voice send to play AI-generated speech for the next reply.',
  'status.transcriptDraft': 'The transcript is in the draft. Edit and send normally, or select Send transcript.',
  'status.awaitingReply': 'Voice message sent. Waiting for AI-generated speech for the next reply.',
  'status.generating': 'Generating AI-generated speech…',
  'status.playing': 'Playing AI-generated speech.',
  'status.profileError': 'Could not load voice features: {message}',
  'status.inputError': 'Voice input failed: {message}',
  'status.playbackError': 'AI-generated speech playback failed: {message}',
  'playback.play': 'Play AI-generated speech',
  'playback.stop': 'Stop AI-generated speech',
  'playback.retry': 'AI-generated speech playback failed; select to retry',
} satisfies Record<VoiceKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Voice recording, send, status, and playback copy. */
    voice: VoiceKey
  }
}
