/** Explicit, credentialed acceptance against an already running local mobile deployment. */
import { chromium } from 'playwright'

const baseUrl = process.env.CEM_MOBILE_LIVE_URL
if (!baseUrl) throw new Error('Set CEM_MOBILE_LIVE_URL to explicitly authorize a real-provider mobile smoke test.')
const target = new URL(baseUrl)
if (!['127.0.0.1', 'localhost', '10.138.135.63'].includes(target.hostname)) throw new Error('Live smoke is restricted to the local deployment.')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, isMobile: true, hasTouch: true })
try {
  const profileResponse = page.waitForResponse(response => response.url().includes('/api/speech/profile?'), { timeout: 60000 })
  await page.goto(new URL('/mobile.html?ui=cem-chat', target).href)
  const response = await profileResponse
  const profile = await response.json()
  if (!response.ok()) throw new Error(`Speech profile HTTP ${response.status()}: ${JSON.stringify(profile)}`)
  const sessionId = new URL(response.url()).searchParams.get('sessionId')
  console.log('Speech capability:', { transcription: !!profile.transcription, synthesis: !!profile.synthesis, realtime: !!profile.transcription?.realtime })
  if (!profile.transcription || !profile.synthesis || !profile.call) throw new Error('Configured speech capabilities missing')
  const greetingResponse = await page.waitForResponse(item => item.url().includes('/api/speech/greeting?') && item.ok(), { timeout: 60000 })
  const greetingUrl = greetingResponse.url()
  const transcript = await page.evaluate(async ({ greetingUrl, sessionId, profile }) => {
    const recording = await (await fetch(greetingUrl)).blob()
    const result = await fetch(`/api/speech/transcribe?${new URLSearchParams({ sessionId, profile })}`, {
      method: 'POST', headers: { 'content-type': 'audio/wav' }, body: recording,
    })
    if (!result.ok) throw new Error(`Real ASR returned HTTP ${result.status}`)
    return await result.json()
  }, { greetingUrl, sessionId, profile: profile.transcription.profile })
  if (!transcript.text?.trim()) throw new Error('Real ASR returned no text')
  console.log('Real ASR recognized fixed test audio:', transcript.text)
  const callButton = page.getByRole('button', { name: '想直接說？ 與澳電助手通話' })
  if (await callButton.count()) await callButton.click()
  else await page.getByRole('button', { name: '開始通話', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '澳電語音通話' })
  await dialog.getByText('正在聆聽，請說…', { exact: true }).waitFor({ timeout: 60000 })
  console.log('Real realtime ASR call connected after greeting')
  await page.screenshot({ path: '/tmp/cem-mobile-live-call.png' })
  await dialog.getByRole('button', { name: '結束通話' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: '輸入您的問題' }).fill('你好，請用一句話介紹你可以協助的澳電服務。')
  await page.getByRole('button', { name: '發送訊息' }).click()
  await page.getByRole('button', { name: '停止回答' }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: '停止回答' }).waitFor({ state: 'hidden', timeout: 180000 })
  const text = await page.getByRole('region', { name: '聊天文字' }).innerText()
  if ((await page.getByRole('region', { name: '聊天文字' }).locator('article').count()) < 2) throw new Error('No real model answer')
  console.log('Real chat completed:', text)
  await page.screenshot({ path: '/tmp/cem-mobile-live-chat.png' })
  await page.reload()
  await page.getByRole('region', { name: '聊天文字' }).waitFor({ timeout: 60000 })
  console.log('Live mobile acceptance passed; physical device audio remains a separate check.')
} catch (error) {
  await page.screenshot({ path: '/tmp/cem-mobile-live-failure.png' })
  console.error(await page.locator('body').innerText())
  throw error
} finally {
  await browser.close()
}
