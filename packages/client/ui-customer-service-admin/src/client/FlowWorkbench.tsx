/** Editable bounded workflow canvas and stepwise rehearsal without business API execution. */
import { useState } from 'react'
import { flowPath, validateFlow } from './demo-data.ts'
import type { Scenario } from './demo-data.ts'
import type { OperationsProps } from './operations-contract.ts'
import { selectedEntry } from './demo-data.ts'
import css from './Operations.module.css'
import { operationsText } from './operations-copy.ts'

/** Render three editable flow templates, graph checks, and deterministic failure branches. */
export function FlowWorkbench(props: OperationsProps) {
  const text = (source: string) => operationsText(props.t, source)
  const flows = props.useStore(state => state.flows)
  const [flowId, setFlowId] = useState('billing')
  const [selected, setSelected] = useState('start')
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [step, setStep] = useState(-1)
  const [validated, setValidated] = useState(false)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; pointerX: number; pointerY: number } | null>(null)
  const flow = selectedEntry(flows.find(item => item.id === flowId))
  const node = selectedEntry(flow.nodes.find(item => item.id === selected))
  const issues = validateFlow(flow)
  const path = flowPath(flow, scenario)
  const active = path[step]
  const update = (label: string, next: string) => {
    props.actions.editNode(flowId, selected, label, next)
    setStep(-1)
    setValidated(false)
  }
  const result = active === 'timeout' ? text('業務查詢超時 → 轉人工分支；坐席線路未接入。')
    : active === 'empty' ? text('沒有匹配記錄 → 澄清信息；不編造業務結果。')
      : active === 'answer' ? flowId === 'billing' ? text('測試賬單：澳門元 328.50，繳費期限 9 月 30 日。')
        : flowId === 'outage' ? text('報修確認：是否需要登記報修？工單接口未接入。') : text('根據工作區知識回答繳費方式；後臺保留來源。')
        : active === 'end' ? text('試運行完成。') : active ? `${text(flow.nodes.find(item => item.id === active)?.label ?? '')}: ${text('使用輸入。')}` : text('選擇場景，開始試運行。')
  return <>
    <div
      className={css.grid3}>
      {flows.map(item =>
        <button
          className={css.answerCard}
          key={item.id}
          aria-pressed={item.id === flowId}
          onClick={() => { setFlowId(item.id); setSelected('start'); setStep(-1); setValidated(false) }}>
          <h2>
            {text(item.name)}
          </h2>
          <p>
            {text(item.description)}
          </p>
          <span
            className={css.badge}>{text('工作區草稿')} ·
            {item.nodes.length} {text('節點')}
          </span>
        </button>)}
    </div>
    <section
      className={css.card}>
      <div
        className={css.sectionHeading}>
        <div>
          <h2>
            {text(flow.name)}
          </h2>
          <p>{text('拖動節點調整佈局；在右側選擇下一節點連線。支持鍵盤方向鍵移動節點。')}
          </p>
        </div>
        <button
          onClick={() => { setValidated(true) }}>{text('檢查流程')}
        </button>
      </div>
      {validated &&
<div
  role="status"
  className={css.banner}>
  {issues.length ? issues.map(text).join('; ') : text('基礎校驗通過：節點可達、名稱完整、出口有效、無循環。')}
</div>}
      <div
        className={css.masterDetail}>
        <div
          className={css.canvas}>
          <svg
            viewBox="0 0 800 450"
            aria-label={text('服務流程畫布')}
            onPointerMove={(event) => {
              if (!drag) return
              const box = event.currentTarget.getBoundingClientRect()
              props.actions.moveNode(flowId, drag.id,
                drag.x + (event.clientX - drag.pointerX) * 800 / box.width,
                drag.y + (event.clientY - drag.pointerY) * 450 / box.height)
            }}
            onPointerUp={() => { setDrag(null) }}
            onPointerCancel={() => { setDrag(null) }}>
            <defs>
              <marker
                id={`arrow-${flowId}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse">
                <path
                  d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {flow.nodes.map((source) => {
              const target = flow.nodes.find(item => item.id === source.next)
              return target ?
                <path
                  key={source.id}
                  className={css.edge}
                  d={`M ${source.x + 160} ${source.y + 35} C ${source.x + 205} ${source.y + 35}, ${target.x - 45} ${target.y + 35}, ${target.x} ${target.y + 35}`}
                  markerEnd={`url(#arrow-${flowId})`} /> : null
            })}
            {flow.nodes.map(item =>
              <g
                key={item.id}
                role="button"
                aria-label={`${text('節點')}: ${text(item.label)}`}
                tabIndex={0}
                className={css.graphNode}
                data-selected={selected === item.id}
                data-running={active === item.id}
                transform={`translate(${item.x}, ${item.y})`}
                onClick={() => { setSelected(item.id) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.id) }
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault(); props.actions.moveNode(flowId, item.id, item.x + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0), item.y + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0))
                  }
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId); setSelected(item.id)
                  setDrag({ id: item.id, x: item.x, y: item.y, pointerX: event.clientX, pointerY: event.clientY })
                }}>
                <rect
                  width="160"
                  height="70"
                  rx="12" />
                <text
                  x="14"
                  y="25"
                  className={css.nodeKind}>
                  {text(item.kind)}
                </text>
                <text
                  x="14"
                  y="49">
                  {text(item.label).slice(0, 18)}
                </text>
              </g>)}
          </svg>
          <div
            className={css.canvasCaption}>{text('正常出口可編輯 · 查詢無記錄 / 超時由調試器展示固定異常出口')}
          </div>
        </div>
        <aside
          className={css.inspector}>
          <h3>{text('節點配置')}
          </h3>
          <div
            className={css.form}>
            <label>{text('節點名稱')}
              <input
                aria-label={text('節點名稱')}
                maxLength={40}
                value={node.label}
                onChange={(event) => { update(event.target.value, node.next) }} />
            </label>
            <label>{text('節點類型')}
              <input
                readOnly
                value={text(node.kind)} />
            </label>
            <label>{text('下一節點 / 連線')}
              <select
                aria-label={text('下一節點')}
                disabled={node.kind === '結束'}
                value={node.next}
                onChange={(event) => { update(node.label, event.target.value) }}>
                <option
                  value="">{text('請選擇出口')}
                </option>
                {flow.nodes.filter(item => item.id !== node.id).map(item =>
                  <option
                    key={item.id}
                    value={item.id}>
                    {text(item.label)}
                  </option>)}
              </select>
            </label>
            <p>{text('操作即時保存到本頁籤工作區草稿。畫布不執行真實查詢或報修。')}
            </p>
          </div>
        </aside>
      </div>
    </section>
    <div
      className={css.columns}>
      <section
        className={css.card}>
        <h2>{text('流程調試')}
        </h2>
        <label
          className={css.form}>{text('調試場景')}
          <select
            aria-label={text('調試場景')}
            value={scenario}
            onChange={(event) => { setScenario(event.target.value as Scenario); setStep(-1) }}>
            <option
              value="normal">{text('正常服務')}
            </option>
            <option
              value="empty">{text('無匹配記錄')}
            </option>
            <option
              value="timeout">{text('查詢超時')}
            </option>
          </select>
        </label>
        <div
          className={css.actions}>
          <button
            className={css.primary}
            disabled={issues.length > 0}
            onClick={() => { setStep(0) }}>{text('開始試運行')}
          </button>
          <button
            disabled={step < 0 || step >= path.length - 1}
            onClick={() => { setStep(step + 1) }}>{text('下一步')}
          </button>
          <button
            disabled={issues.length > 0}
            onClick={() => { setStep(path.length - 1) }}>{text('運行至結束')}
          </button>
        </div>
        <div
          className={css.bubble}
          role="status">
          {result}
        </div>
      </section>
      <section
        className={css.card}>
        <h2>{text('運行記錄')}
        </h2>
        <ol
          className={css.timeline}>
          {path.slice(0, step + 1).map((id, index) =>
            <li
              key={id}>
              <strong>
                {index + 1}.
                {text(flow.nodes.find(item => item.id === id)?.label ?? (id === 'timeout' ? '超時轉人工' : '無記錄澄清'))}
              </strong>
              <small>{text('調試步驟 · 不計入真實服務耗時')}
              </small>
            </li>)}
        </ol>
        {step < 0 &&
<p>{text('尚未運行。')}
</p>}
      </section>
    </div>
    <section
      className={css.card}>
      <h2>{text('流程變量')}
      </h2>
      <table>
        <thead>
          <tr>
            <th>{text('變量')}
            </th>
            <th>{text('來源')}
            </th>
            <th>{text('展示規則')}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{text('客戶身份')}
            </td>
            <td>{text('身份確認節點')}
            </td>
            <td>{text('僅使用測試賬戶')}
            </td>
          </tr>
          <tr>
            <td>{text('查詢結果')}
            </td>
            <td>{text('調試場景')}
            </td>
            <td>{text('正常 / 無記錄 / 超時')}
            </td>
          </tr>
          <tr>
            <td>{text('回答依據')}
            </td>
            <td>{text('工作區模板或知識')}
            </td>
            <td>{text('後臺可見，電話不念編號')}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </>
}
