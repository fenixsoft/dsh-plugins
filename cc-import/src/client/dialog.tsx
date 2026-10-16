/**
 * cc-import 导入对话框组件（展示层）。
 *
 * 职责：候选行渲染（勾选框 / 名称 / baseURL / 模型摘要 / 状态标列布局）、
 * 勾选态管理（全选新增 / 取消全部选择）、批次结果反馈。数据加载（scan +
 * settings 快照）与导入执行由 index.ts 以回调注入，本组件不触碰任何服务。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Translate } from '@deepseek-ai/cordis'
import { Button, Checkbox, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { splitModelAlias } from '../shared/mapping.js'
import type { ScanCandidate, ScanResponse } from '../shared/mapping.js'
import { planImports, rowState } from './importer.js'
import type { ExistingProviders, ImportPlan } from './importer.js'

/** 对话框应答：候选 + 既有 providers 快照，或失败消息。 */
export type DialogSnapshot =
  | { readonly ok: true; readonly candidates: readonly ScanCandidate[]; readonly existing: ExistingProviders }
  | { readonly ok: false; readonly message: string }

/** 一次批次导入的结果反馈。 */
export interface ImportOutcome {
  readonly succeeded: number
  readonly failures: readonly { readonly name: string; readonly reason: string }[]
}

export interface ImportDialogProps {
  readonly t: Translate
  readonly open: boolean
  readonly onClose: () => void
  /** 打开时加载候选与既有 providers（index.ts 注入）。 */
  readonly loadSnapshot: () => Promise<DialogSnapshot>
  /** 执行勾选集的导入（index.ts 注入；conflict 重试与单项隔离在其内部）。 */
  readonly runImport: (plan: ImportPlan) => Promise<ImportOutcome>
}

interface RowState {
  readonly candidate: ScanCandidate
  readonly existed: boolean
  readonly checked: boolean
  readonly update: boolean
}

/** 对话框 80% 视口宽样式类（样式经 ensureDialogStyle 注入，见文件尾）。 */
export const DIALOG_WIDE_CLASS = 'fenix-ccimport-dialog-wide'

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '6px 4px',
  borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.25))',
}

/** 候选行列宽：名称 / baseURL / 模型摘要三列弹性间隔，状态标固定收缩。 */
const colNameStyle: CSSProperties = { flex: '1.1 1 0', minWidth: 0, fontWeight: 600, overflowWrap: 'anywhere' }

const colBaseURLStyle: CSSProperties = {
  flex: '1.6 1 0',
  minWidth: 0,
  fontSize: 12,
  opacity: 0.72,
  overflowWrap: 'anywhere',
}

const colModelStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  fontSize: 12,
  opacity: 0.72,
  overflowWrap: 'anywhere',
}

const badgeStyle = {
  flexShrink: 0,
  fontSize: 12,
  borderRadius: 6,
  padding: '2px 8px',
  border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.35))',
  whiteSpace: 'nowrap',
} satisfies CSSProperties

const listStyle = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '46vh',
  overflowY: 'auto',
  margin: '8px 0',
} satisfies CSSProperties

/** 状态标文案：可导入 / 已存在（+将更新）/ 跳过-原因。 */
function statusLabel(t: Translate, row: RowState): string {
  if (!row.candidate.importable) {
    return `${t('status.skipped')} · ${t(`skip.${row.candidate.skipReason ?? 'missing_model'}`)}`
  }
  if (row.existed) return row.update ? t('status.update') : t('status.existed')
  return t('status.importable')
}

/** 单个候选行：跳过行无勾选框；已存在行默认不勾选、勾选即「将更新」。
 *  列布局（80vw 对话框下）：勾选框 / 名称 / baseURL / 模型摘要 / 状态标。 */
function CandidateRow({
  t,
  row,
  onToggle,
}: {
  readonly t: Translate
  readonly row: RowState
  readonly onToggle: (name: string, checked: boolean) => void
}) {
  const candidate = row.candidate
  const model = candidate.model === null ? null : splitModelAlias(candidate.model)
  return (
    <div style={rowStyle} role="listitem" data-testid={`ccimport-row-${candidate.name}`}>
      {candidate.importable ? (
        <Checkbox
          checked={row.checked}
          onChange={(next) => onToggle(candidate.name, next)}
          label={candidate.name}
          title={row.existed ? t('check.update') : undefined}
        />
      ) : (
        <span style={{ width: 18, flexShrink: 0 }} aria-hidden="true" />
      )}
      <span style={colNameStyle}>{candidate.name}</span>
      <span style={colBaseURLStyle}>{candidate.baseURL ?? '—'}</span>
      <span style={colModelStyle}>
        {model === null
          ? '—'
          : `${model.id}${model.contextWindow === undefined ? '' : ` · ${t('model.contextWindow')}`}`}
      </span>
      <span style={badgeStyle}>{statusLabel(t, row)}</span>
    </div>
  )
}

/**
 * 导入对话框：打开时加载快照，渲染候选行与勾选态，确认后把写入计划交给
 * runImport 执行并反馈「成功 N + 失败明细」。
 */
export function ImportDialog({ t, open, onClose, loadSnapshot, runImport }: ImportDialogProps) {
  const [snapshot, setSnapshot] = useState<DialogSnapshot | null>(null)
  const [rows, setRows] = useState<readonly RowState[]>([])
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  /** busy 的来源：false=加载快照，true=执行导入（busy 文案随此区分）。 */
  const [importing, setImporting] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  /** 导入请求代数：effect 清理（关窗等）即自增失效，confirm 的迟到回写据此丢弃。 */
  const importTokenRef = useRef(0)

  useEffect(() => {
    if (!open) {
      setSnapshot(null)
      setRows([])
      setOutcome(null)
      setBusy(false)
      setImporting(false)
      setReloadToken(0)
      return
    }
    let cancelled = false
    setBusy(true)
    void loadSnapshot()
      .then((loaded) => {
        if (cancelled) return
        setSnapshot(loaded)
        setOutcome(null)
        setBusy(false)
        if (loaded.ok) {
          const existingNames = new Set(Object.keys(loaded.existing))
          setRows(
            loaded.candidates.map((candidate) => {
              const state = rowState(candidate, existingNames)
              return { candidate, existed: state.existed, checked: state.defaultChecked, update: false }
            }),
          )
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSnapshot({ ok: false, message: error instanceof Error ? error.message : String(error) })
        setOutcome(null)
        setBusy(false)
      })
    return () => {
      cancelled = true
      importTokenRef.current += 1
    }
  }, [open, loadSnapshot, reloadToken])

  const toggle = useMemo(
    () =>
      (name: string, checked: boolean): void => {
        setRows((current) =>
          current.map((row) => {
            if (row.candidate.name !== name) return row
            return { ...row, checked, update: checked && row.existed }
          }),
        )
      },
    [],
  )

  const selectedNames = useMemo(
    () => new Set(rows.filter((row) => row.checked).map((row) => row.candidate.name)),
    [rows],
  )
  const updateNames = useMemo(
    () => new Set(rows.filter((row) => row.checked && row.update).map((row) => row.candidate.name)),
    [rows],
  )
  const preview = useMemo(
    () =>
      snapshot?.ok === true
        ? planImports(snapshot.candidates, { names: selectedNames, updateNames }, snapshot.existing)
        : null,
    [snapshot, selectedNames, updateNames],
  )

  const confirm = (): void => {
    if (preview === null || preview.planned.length === 0) return
    const token = importTokenRef.current
    setBusy(true)
    setImporting(true)
    setOutcome(null)
    void runImport(preview)
      .then((result) => {
        if (token !== importTokenRef.current) return
        setOutcome(result)
        setBusy(false)
        setImporting(false)
      })
      .catch((error: unknown) => {
        if (token !== importTokenRef.current) return
        setOutcome({
          succeeded: 0,
          failures: [
            {
              name: '*',
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        })
        setBusy(false)
        setImporting(false)
      })
  }

  const selectable = rows.filter((row) => row.candidate.importable)
  const errorText =
    snapshot?.ok === false
      ? t('scan.failed', { message: snapshot.message })
      : snapshot?.ok === true && snapshot.candidates.length === 0
        ? t('scan.empty')
        : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('dialog.title')}
      closeLabel={t('dialog.close')}
      description={t('dialog.description')}
      className={DIALOG_WIDE_CLASS}
    >
      {busy && outcome === null ? <p>{importing ? t('import.running') : t('dialog.loading')}</p> : null}
      {errorText !== null ? <p role="alert">{errorText}</p> : null}
      {snapshot?.ok === true && rows.length > 0 ? (
        <div style={listStyle} role="list">
          {rows.map((row) => (
            <CandidateRow key={row.candidate.name} t={t} row={row} onToggle={toggle} />
          ))}
        </div>
      ) : null}
      {outcome !== null ? (
        <div>
          <p>{t('import.done', { count: outcome.succeeded })}</p>
          {outcome.failures.length > 0 ? (
            <div>
              <p>{t('import.failures', { count: outcome.failures.length })}</p>
              <ul>
                {outcome.failures.map((failure) => (
                  <li key={failure.name}>
                    {failure.name}: {failure.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReloadToken((token) => token + 1)}>
          {t('dialog.refresh')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setRows((current) => current.map((row) => {
              if (!row.candidate.importable || row.existed) return row
              return { ...row, checked: true }
            }))
          }}
        >
          {t('dialog.selectAll')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="ccimport-deselect-all"
          disabled={busy || selectedNames.size === 0}
          onClick={() => {
            setRows((current) => current.map((row) => (row.checked ? { ...row, checked: false, update: false } : row)))
          }}
        >
          {t('dialog.deselectAll')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('dialog.close')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || preview === null || preview.planned.length === 0}
          onClick={confirm}
        >
          {t('dialog.import', { count: preview?.planned.length ?? 0 })}
        </Button>
      </div>
    </Modal>
  )
}

/** scan 应答 → 对话框快照的适配（index.ts 的 loadSnapshot 使用）。 */
export function snapshotFromScan(
  scanned: ScanResponse,
  existing: ExistingProviders,
): DialogSnapshot {
  if (!scanned.ok) return { ok: false, message: scanned.message }
  return { ok: true, candidates: scanned.candidates, existing }
}

/**
 * 注入对话框 80% 视口宽样式（幂等；形态对齐 dsh 插件包的
 * `style[data-plugin-css]` 注入先例）。Modal 卡片缺省 `width: min(380px, 100%)`，
 * 双写类名提升优先级压过原规则；node/SSR 环境跳过。
 */
interface StyleHost {
  head: { appendChild(node: unknown): unknown }
  querySelector(selector: string): unknown
  createElement(tag: string): { setAttribute(name: string, value: string): void; textContent?: string }
}

export function ensureDialogStyle(doc: StyleHost | undefined): void {
  if (doc === undefined) return
  const tagId = 'cc-import/dialog-width'
  if (doc.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
  const tag = doc.createElement('style')
  // dataset 整体赋值在部分引擎上不落 data-plugin-css（实测 0.2.0-rc.2 web），
  // 逐条 setAttribute 保证幂等标记可靠。
  tag.setAttribute('data-plugin', 'cc-import')
  tag.setAttribute('data-plugin-css', tagId)
  tag.textContent = `.${DIALOG_WIDE_CLASS}.${DIALOG_WIDE_CLASS}{width:80vw;max-width:none}`
  doc.head.appendChild(tag)
}
ensureDialogStyle(typeof document === 'undefined' ? undefined : (document as unknown as StyleHost))

/** footer 条目组件：入口按钮 + 对话框（open 态本地持有）。 */
export interface FooterSeats {
  readonly t: Translate
  readonly loadSnapshot: () => Promise<DialogSnapshot>
  readonly runImport: (plan: ImportPlan) => Promise<ImportOutcome>
}

/** Models 页 footer 注入的条目：按钮常驻，点击打开导入对话框。 */
export function ImportFooterEntry({ t, loadSnapshot, runImport }: FooterSeats) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('action.import')}
      </Button>
      <ImportDialog
        t={t}
        open={open}
        onClose={() => setOpen(false)}
        loadSnapshot={loadSnapshot}
        runImport={runImport}
      />
    </>
  )
}
