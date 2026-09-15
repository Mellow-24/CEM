/** Channel, pronunciation, and prompt rehearsal forms; production settings remain separate. */
import { useState } from 'react'
import type { OperationsProps } from './operations-contract.ts'
import { PRONUNCIATIONS } from './demo-data.ts'
import { selectedEntry } from './demo-data.ts'
import {
  ADDRESS_ALIASES, applyPronunciationRules, BANK_ALIASES, PRONUNCIATION_RULES,
  type PronunciationPreview, type SpeechLanguage,
} from './pronunciation-rules.ts'
import css from './Operations.module.css'
import { operationsText } from './operations-copy.ts'

/** Present the two deployed strategies and editable synthetic channel previews. */
export function AgentWorkbench(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const [channel, setChannel] = useState('電話')
  const [greeting, setGreeting] = useState(selectedEntry(draft.channels[channel]).greeting)
  const [language, setLanguage] = useState(selectedEntry(draft.channels[channel]).language)
  const [enabled, setEnabled] = useState(selectedEntry(draft.channels[channel]).enabled)
  const savedChannel = selectedEntry(draft.channels[channel])
  const channelChanged = greeting !== savedChannel.greeting || language !== savedChannel.language || enabled !== savedChannel.enabled
  const selectChannel = (value: string) => {
    setChannel(value); setGreeting(selectedEntry(draft.channels[value]).greeting)
    setLanguage(selectedEntry(draft.channels[value]).language); setEnabled(selectedEntry(draft.channels[value]).enabled)
  }
  return <>
    <div
      className={css.columns}>
      {([
        ['澳門智能客服', '知識檢索型', '基於已審核資料檢索回答，適用於日常繳費與服務諮詢。'],
        ['澳門智能客服 · 知識導航', '知識導航型', '按知識主題組織資料，適用於結構化服務政策查詢。'],
      ] as const).map(([name, strategy, description]) =>
        <section
          className={css.card}
          key={name}>
          <span
            className={css.badge}>
            {text(strategy)}
          </span>
          <h2>
            {text(name)}
          </h2>
          <p>
            {text(description)}
          </p>
          <div
            className={css.tags}>
            <span>{text('澳門粵語')}
            </span>
            <span>{text('繁體中文')}
            </span>
            <span>{text('葡語')}
            </span>
          </div>
          <button
            onClick={() => { props.navigate?.('agent-presets') }}>{text('智能體配置')}
          </button>
        </section>)}
    </div>
    <section
      className={css.card}>
      <h2>{text('渠道接入與服務預覽')}
      </h2>
      <p>{text('接入狀態：未接入 · 可先配置服務入口與歡迎語。')}
      </p>
      <div
        className={css.tabs}>
        {['電話', 'Web', 'App'].map(value =>
          <button
            key={value}
            aria-pressed={channel === value}
            onClick={() => { selectChannel(value) }}>
            {text(value)}
          </button>)}
      </div>
      <div
        className={css.columns}>
        <form
          className={css.form}
          onSubmit={(event) => { event.preventDefault(); props.actions.saveChannel(channel, greeting, language, enabled) }}>
          <label>{text('渠道名稱')}
            <input
              value={`CEM Macau · ${text(channel)}`}
              readOnly />
          </label>
          <label>{text('預設語言')}
            <select
              value={language}
              onChange={(event) => { setLanguage(event.target.value) }}>
              {['澳門粵語', '繁體中文', '普通話', '葡語', '英語'].map(value =>
                <option
                  key={value}
                  value={value}>
                  {text(value)}
                </option>)}
            </select>
          </label>
          <label>{text('歡迎語')}
            <textarea
              required
              maxLength={500}
              value={greeting}
              onChange={(event) => { setGreeting(event.target.value) }} />
          </label>
          <label
            className={css.check}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => { setEnabled(event.target.checked) }} />{text('啟用服務入口')}
          </label>
          <p>
            {text(channel === '電話' ? '服務路由：歡迎語 → 語言選擇 → 智能服務 → 必要時轉人工。未接入真實號碼。' : '入口：服務諮詢 · 賬單查詢 · 停電報修；使用客戶身份。')}
          </p>
          <button
            className={css.primary}
            disabled={!channelChanged}
            type="submit">{text('保存渠道草稿')}
          </button>
          <small role="status">{text(channelChanged ? '有未保存的修改' : '草稿已保存')}</small>
        </form>
        <div
          className={css.preview}>
          <span
            className={css.eyebrow}>
            {text(channel)} · {text('效果預覽')}
          </span>
          <div
            className={css.avatar}>深
          </div>
          <h2>{text('澳電智能客服')}
          </h2>
          <span
            className={css.badge}>
            {text(enabled ? '預覽已啟用' : '預覽已停用')} ·
            {text(language)}
          </span>
          <div
            className={css.bubble}>
            {enabled ? greeting : text('服務入口已停用。')}
          </div>
          <div
            className={css.tags}>
            <span>{text('繳費諮詢')}
            </span>
            <span>{text('賬單查詢')}
            </span>
            <span>{text('停電報修')}
            </span>
          </div>
          <small>{text('預覽不發起真實通話，也不播放合成語音。')}
          </small>
        </div>
      </div>
    </section>
  </>
}

function RuleLibrary(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const [language, setLanguage] = useState<SpeechLanguage>('澳門粵語')
  const [category, setCategory] = useState('全部規則')
  const [selectedId, setSelectedId] = useState<string>(PRONUNCIATION_RULES[0].id)
  const [tryoutText, setTryoutText] = useState('請於12月18日前繳付$50，地址是澳門123棟 R/C+S/L，也可通過BNU繳費。')
  const [preview, setPreview] = useState<PronunciationPreview>()
  const matching = PRONUNCIATION_RULES.filter(rule =>
    (rule.languages as readonly SpeechLanguage[]).includes(language)
      && (category === '全部規則' || rule.category === category))
    .sort((left, right) => left.priority - right.priority)
  const selected = matching.find(rule => rule.id === selectedId) ?? matching[0] ?? PRONUNCIATION_RULES[0]
  const enabled = new Set(Object.entries(draft.pronunciationRules).filter(([, value]) => value).map(([id]) => id))
  const run = () => { setPreview(applyPronunciationRules(tryoutText, language, enabled)) }
  return <>
    <section className={css.hero}>
      <div>
        <span className={css.eyebrow}>{text('語音文本規範化')}</span>
        <h2>{text('先按語言和場景處理通用讀法')}</h2>
        <p>{text('會話原文保持不變，只對送入 TTS 的文本副本展開縮寫、數字、日期和金額。')}</p>
      </div>
      <span className={css.badge}>{text('規則草稿')} v{draft.pronunciationRuleVersion}</span>
    </section>
    <ol className={css.pipeline} aria-label={text('發音規則生效流程')}>
      {[(props.standalone ? '客服回答' : '模型回答'), '確定語言', '通用規則', '詞條糾偏', 'TTS 適配', '語音輸出'].map((step, index) =>
        <li key={step} data-done={index < 4}><span>{index + 1}</span>{text(step)}</li>)}
    </ol>
    <section className={css.card}>
      <div className={css.sectionHeading}>
        <div><h2>{text('通用發音規則')}</h2><p>{text('優先級數字越小越先執行；後續的精確詞條可以覆蓋通用結果。')}</p></div>
        <span className={css.badge}>{enabled.size} / {PRONUNCIATION_RULES.length} {text('已啟用')}</span>
      </div>
      <div className={css.filterBar}>
        <label className={css.inlineField}>{text('語言')}
          <select
            aria-label={text('試讀語言')}
            value={language}
            onChange={(event) => { setLanguage(event.target.value as SpeechLanguage); setPreview(undefined) }}>
            {['澳門粵語', '普通話', '葡語', '英語'].map(value => <option key={value} value={value}>{text(value)}</option>)}
          </select>
        </label>
        <label className={css.inlineField}>{text('類型')}
          <select aria-label={text('發音規則類型')} value={category} onChange={(event) => { setCategory(event.target.value) }}>
            {['全部規則', '地址', '數字', '機構', '金額', '日期'].map(value => <option key={value} value={value}>{text(value)}</option>)}
          </select>
        </label>
        <span className={css.sourceLabel}>{text('當前語言可用')} {matching.length} {text('條')}</span>
      </div>
      <div className={css.masterDetail}>
        <div className={css.tableWrap}>
          <table><thead><tr><th>{text('優先級')}</th><th>{text('規則')}</th><th>{text('語言')}</th><th>{text('匹配')}</th><th>{text('狀態')}</th></tr></thead>
            <tbody>{matching.map(rule => <tr key={rule.id} data-selected={rule.id === selected.id}>
              <td>{rule.priority}</td><td><button
                className={css.link}
                onClick={() => { setSelectedId(rule.id) }}>{text(rule.name)}</button></td>
              <td>{rule.languages.map(text).join(' / ')}</td><td>{text(rule.matchType)}</td>
              <td><span className={draft.pronunciationRules[rule.id] ? css.success : undefined}>
                {text(draft.pronunciationRules[rule.id] ? '已啟用' : '已停用')}
              </span></td>
            </tr>)}</tbody></table>
        </div>
        <aside className={css.inspector}>
          <h3>{text(selected.name)}</h3>
          <dl className={css.facts}>
            <dt>{text('匹配方式')}</dt><dd>{text(selected.matchType)}</dd><dt>{text('規則條件')}</dt><dd><code>{selected.pattern}</code></dd>
            <dt>{text('輸出方式')}</dt><dd>{text(selected.output)}</dd><dt>{text('參考')}</dt><dd>{selected.source}</dd>
          </dl>
          <div className={css.bubble}>
            <small>{text('規則範例')}</small><p>{selected.exampleInput}</p><p>→ {selected.exampleOutput}</p>
          </div>
          <label className={css.switchRow}>
            <input
              type="checkbox"
              aria-label={`${text('啟用此規則')}: ${text(selected.name)}`}
              checked={draft.pronunciationRules[selected.id] ?? false}
              onChange={(event) => {
                props.actions.togglePronunciationRule(selected.id, event.target.checked); setPreview(undefined)
              }} />{text('啟用此規則')}
          </label>
          <small>{text('變更僅保存在當前工作區，未發佈到電話服務。')}</small>
        </aside>
      </div>
    </section>
    <section className={css.card}>
      <div className={css.sectionHeading}>
        <div><h2>{text('規則試讀')}</h2><p>{text('顯示文本與播報文本分開，便於核對知識庫縮寫和地址。')}</p></div>
        <span className={css.badge}>{text(language)}</span>
      </div>
      <label className={css.form}>{text('測試文本')}
        <textarea
          aria-label={text('發音規則測試文本')}
          value={tryoutText}
          onChange={(event) => { setTryoutText(event.target.value); setPreview(undefined) }} />
      </label>
      <button className={css.primary} onClick={run} disabled={!tryoutText.trim()}>{text('運行規則試讀')}</button>
      {preview && <div className={css.compare}>
        <div><small>{text('客戶看到的文本')}</small><p>{preview.displayText}</p></div>
        <div><small>{text('送入 TTS 的文本')}</small><p>{preview.spokenText}</p><div className={css.tags}>
          {preview.matches.length
            ? preview.matches.map(match => <span key={match.ruleId}>{match.name} × {match.count}</span>)
            : <span>{text('未命中規則')}</span>}
        </div></div>
      </div>}
    </section>
  </>
}

function ReferenceAddressLibrary(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  return <section className={css.card}>
    <div className={css.sectionHeading}>
      <div><h2>{text('澳門地址與機構縮寫')}</h2><p>{text('用於通用規則的參考對照，不覆蓋客戶看到的標準名稱。')}</p></div>
      <span className={css.badge}>{text('參考表已錄入')}</span>
    </div>
    <div className={css.columns}>
      <div className={css.tableWrap}><table><thead><tr><th>{text('地址縮寫')}</th><th>{text('播報語義')}</th></tr></thead><tbody>
        {ADDRESS_ALIASES.map(([alias, meaning]) => <tr key={alias}><td>{alias}</td><td>{meaning}</td></tr>)}
      </tbody></table></div>
      <div className={css.tableWrap}><table><thead><tr><th>{text('銀行縮寫')}</th><th>{text('中文')}</th><th>{text('英文 / 葡文名稱')}</th></tr></thead><tbody>
        {BANK_ALIASES.map(([alias, chinese, latin]) => <tr key={alias}>
          <td>{alias}</td><td>{chinese}</td><td>{latin}</td>
        </tr>)}
      </tbody></table></div>
    </div>
  </section>
}

function TermCorrection(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState(draft.terms[draft.selectedTerm] ?? '')
  const [category, setCategory] = useState('全部詞條')
  const matchingTerms = PRONUNCIATIONS.filter(([term, , portuguese, kind]) =>
    `${term} ${draft.terms[term] ?? ''} ${portuguese} ${kind}`.toLowerCase().includes(query.trim().toLowerCase())
    && (category === '全部詞條' || (category === '待補充' ? !draft.terms[term] : kind === category)))
  const select = (term: string) => { props.actions.selectTerm(term); setReading(draft.terms[term] ?? '') }
  return <section className={css.card}>
    <div className={css.sectionHeading}>
      <div><h2>{text('詞條糾偏')}</h2><p>{text('對地名和業務詞做完整詞匹配，優先於通用規則，不做全局單字替換。')}</p></div>
      <span className={css.badge}>{text('詞條草稿')} v{draft.termVersion}</span>
    </div>
    <input type="search" aria-label={text('搜索地址或詞條')} placeholder={text('搜索中文、葡文、讀音…')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
    <div className={css.filterBar}>
      <select aria-label={text('詞條分類')} value={category} onChange={(event) => { setCategory(event.target.value) }}>
        {['全部詞條', '地名', '業務', '機構', '幣種', '待補充'].map(value => <option key={value} value={value}>{text(value)}</option>)}
      </select><span className={css.sourceLabel}>{matchingTerms.length} {text('個詞條')}</span><button onClick={() => { setQuery(''); setCategory('全部詞條') }}>{text('清空篩選')}</button>
    </div>
    <div className={css.masterDetail}>
      <div className={css.tableWrap}><table><thead><tr><th>{text('詞條')}</th><th>{text('葡文 / 標識')}</th><th>{text('類別')}</th><th>{text('粵拼糾偏')}</th></tr></thead><tbody>
        {matchingTerms.map(([term, , portuguese, kind]) => <tr key={term} data-selected={term === draft.selectedTerm}>
          <td><button className={css.link} onClick={() => { select(term) }}>{term}</button></td><td>{portuguese}</td><td>{text(kind)}</td><td>{draft.terms[term] || text('待補充')}</td>
        </tr>)}</tbody></table>{!matchingTerms.length && <p>{text('沒有匹配的詞條。')}</p>}</div>
      <aside className={css.inspector}>
        <h3>{draft.selectedTerm} · {text('糾偏詳情')}</h3><p>{text('場景：澳門地址播報')}<br />{text('語言：澳門粵語')}<br />{text('範圍：完整詞條匹配')}</p>
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); props.actions.saveTerm(draft.selectedTerm, reading) }}>
          <label>{text('粵拼讀音')}<input required aria-label={text('粵拼讀音')} value={reading} maxLength={100} onChange={(event) => { setReading(event.target.value) }} /></label>
          <button disabled={reading.trim() === (draft.terms[draft.selectedTerm] ?? '')} className={css.primary}>{text('保存詞條糾偏')}</button>
          <small role="status">{text(reading.trim() === (draft.terms[draft.selectedTerm] ?? '') ? '當前版本已保存' : '有未保存的修改')}</small>
        </form>
        <div className={css.bubble}><small>{text('結構化讀音預覽 · 非合成試聽')}</small><p>{text('原詞：')} {draft.selectedTerm}</p><p>{text('粵拼：')} {reading || text('尚未填寫')}</p></div>
        {draft.selectedTerm === '氹仔' && <button onClick={() => { setReading('taam5 zai2') }}>{text('使用推薦讀音')}</button>}
        <p>{text('此層用於通用規則無法解決的專名、地名和多音字。')}</p>
        <button onClick={() => { props.navigate?.('customer-service-evaluation') }}>{text('查看會話質檢 →')}</button>
      </aside>
    </div>
  </section>
}

/** Show pronunciation management; legacy Settings also exposes model and prompt rehearsal. */
export function VoiceWorkbench(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const draft = props.useStore(state => state)
  const tabs = props.standalone
    ? ['發音規則庫', '詞條糾偏', '澳門地址庫']
    : ['模型配置', '提示詞模板', '發音規則庫', '詞條糾偏', '澳門地址庫']
  const tab = tabs.includes(draft.voiceTab) ? draft.voiceTab : '發音規則庫'
  const [prompt, setPrompt] = useState(selectedEntry(draft.answers['C']))
  return <>
    <div
      className={css.tabs}
      role="group"
      aria-label={text(props.standalone ? '發音管理分類' : '模型與發音分類')}>
      {tabs.map(value =>
        <button
          key={value}
          aria-pressed={tab === value}
          onClick={() => { props.actions.selectVoiceTab(value) }}>
          {text(value)}
        </button>)}
    </div>
    {tab === '模型配置' ? <>
      <div
        className={css.grid3}>
        {([
          ['對話模型', '組織自然語言回答', '可配置'], ['向量模型', '將知識轉為可檢索表示', '由知識庫配置管理'],
          ['重排模型', '優化候選知識排序', '由檢索配置管理'], ['語音識別', '將客戶語音轉為文字', '沿用當前電話服務'], ['語音合成', '將回復轉為自然語音', '沿用當前電話服務'],
        ] as const).map(([name, description, status]) =>
          <section
            className={css.card}
            key={name}>
            <span
              className={css.badge}>{text('能力目錄')}
            </span>
            <h2>
              {text(name)}
            </h2>
            <p>
              {text(description)}
            </p>
            <small>
              {text(status)}
            </small>
          </section>)}
      </div>
      <section
        className={css.card}>
        <h2>{text('模型與服務配置')}
        </h2>
        <p>{text('此目錄不代表端點健康檢查。工作區草稿不會覆蓋實際模型、密鑰或語音配置。')}
        </p>
        <button
          className={css.primary}
          onClick={() => { props.navigate?.('models') }}>{text('管理模型配置')}
        </button>
      </section></>
      : tab === '提示詞模板' ?
        <section
          className={css.card}>
          <h2>{text('C 類知識問答提示詞')}
          </h2>
          <p>{text('工作區模板 · 僅修改後臺預覽，不注入真實客服會話。')}
          </p>
          <form
            className={css.form}
            onSubmit={(event) => { event.preventDefault(); props.actions.saveAnswer('C', prompt) }}>
            <label>{text('回答要求')}
              <textarea
                required
                maxLength={4000}
                value={prompt}
                onChange={(event) => { setPrompt(event.target.value) }} />
            </label>
            <p>{text('約束：僅使用審核知識；證據不足時澄清；後臺顯示依據；電話播報不含文檔編號。')}
            </p>
            <button
              className={css.primary}>{text('保存提示詞草稿')}
            </button>
          </form>
        </section>
        : tab === '發音規則庫' ? <RuleLibrary {...props} />
          : tab === '詞條糾偏' ? <TermCorrection {...props} />
            : <ReferenceAddressLibrary {...props} />}
  </>
}
