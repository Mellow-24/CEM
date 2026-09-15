import { expect, it } from 'vitest'
import { CallTranscript } from '../src/client/call-transcript.ts'

it('retains the opening and one evolving draft across recognizer segments', () => {
  const transcript = new CallTranscript()
  expect(transcript.entries).toEqual([])
  transcript.start('您好。')
  transcript.recognize(' ')
  expect(transcript.entries).toHaveLength(1)
  transcript.recognize('查電費')
  const previous = transcript.entries
  transcript.recognize('查電費')
  expect(transcript.entries).toBe(previous)
  transcript.recognize('查電費\n上個月的')
  transcript.finishUtterance(true)
  transcript.finishUtterance(true)
  expect(transcript.entries).toEqual([
    { id: 'greeting', speaker: 'assistant', text: '您好。', status: 'complete' },
    { id: 'user:1', speaker: 'user', text: '查電費\n上個月的', status: 'complete' },
  ])
})

it('keeps interrupted and unsubmitted text without marking older answers', () => {
  const transcript = new CallTranscript()
  transcript.start('您好。')
  transcript.beginReply()
  transcript.answer('a1', '第一個回答。', true)
  transcript.beginReply()
  transcript.answer('a2', '', false)
  transcript.answer('a2', '未完', false)
  transcript.answer('a2', '未完成的回答。', true)
  transcript.interrupt()
  transcript.interrupt()
  transcript.recognize('未提交的話')
  transcript.finishUtterance(false)
  expect(transcript.entries.map(({ text, status }) => ({ text, status }))).toEqual([
    { text: '您好。', status: 'complete' }, { text: '第一個回答。', status: 'complete' },
    { text: '未完成的回答。', status: 'interrupted' }, { text: '未提交的話', status: 'unsubmitted' },
  ])
  transcript.start('新通話')
  expect(transcript.entries).toHaveLength(1)
  transcript.recognize('新問題')
  expect(transcript.entries[1]?.id).toBe('user:1')
})
