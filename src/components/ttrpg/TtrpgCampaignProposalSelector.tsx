import type { TtrpgCampaignDesignV2, TtrpgCampaignProposalSectionV2 } from '../../lib/types'
import {
  parseTtrpgCampaignDesignV2,
  TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2,
} from '../../lib/ttrpg/campaign-proposal'

const SECTION_LABELS: Record<TtrpgCampaignProposalSectionV2, string> = {
  background: '背景', coreConflict: '核心冲突', opening: '开场', fronts: 'Front / 压力',
  secrets: '秘密', endings: '结局方向',
}

export default function TtrpgCampaignProposalSelector(props: {
  value: TtrpgCampaignDesignV2
  onChange: (value: TtrpgCampaignDesignV2) => void
  onGenerateAi?: (sections?: TtrpgCampaignProposalSectionV2[]) => void
  aiGenerating?: boolean
  aiReady?: boolean
}) {
  const update = (mutate: (draft: TtrpgCampaignDesignV2) => void) => {
    const next = structuredClone(props.value)
    mutate(next)
    props.onChange(parseTtrpgCampaignDesignV2(next))
  }
  return <section className="mt-4 rounded border border-accent/30 bg-accent/5 p-4" data-testid="ttrpg-campaign-proposal-selector">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><strong className="text-xs text-text-primary">战役提案比较、混合与锁定</strong><p className="mt-1 text-[10px] text-text-muted">先选一个基底，再允许每个分区来自不同提案。锁定后，装配器会逐项证明内容没有被后续生成静默改写。</p></div>
      <div className="flex items-center gap-2"><span className="rounded border border-border px-2 py-1 text-[9px] text-text-muted">{props.value.origin === 'ai-candidate' ? `AI candidate · Run #${props.value.candidateEvidence?.runId}` : '作者引导候选 · 无模型调用'}</span>{props.onGenerateAi && <button type="button" disabled={props.aiGenerating || !props.aiReady} onClick={() => props.onGenerateAi?.()} className="rounded bg-purple-600 px-3 py-2 text-[10px] text-white disabled:opacity-40">{props.aiGenerating ? '生成中…' : props.value.origin === 'ai-candidate' ? '重生成未锁定分区' : '生成 AI 提案'}</button>}</div>
    </div>
    <div className="mt-3 grid gap-2 lg:grid-cols-3">
      {props.value.proposals.map((proposal) => <article key={proposal.proposalKey} className={`rounded border p-3 ${props.value.selection.baseProposalKey === proposal.proposalKey ? 'border-accent bg-bg-elevated' : 'border-border bg-bg-base'}`}>
        <div className="flex items-start justify-between gap-2"><strong className="text-xs text-text-primary">{proposal.title}</strong><button type="button" onClick={() => update(next => {
          next.selection.baseProposalKey = proposal.proposalKey
          for (const section of TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2) {
            if (!next.selection.lockedSections.includes(section)) next.selection.sectionSources[section] = proposal.proposalKey
          }
          next.selection.confirmed = false
        })} className="rounded border border-accent/40 px-2 py-1 text-[9px] text-accent">设为基底</button></div>
        <p className="mt-2 text-[10px] leading-5 text-text-muted">{proposal.pitch}</p>
        <dl className="mt-2 grid gap-1 text-[9px] text-text-secondary"><div><dt className="inline text-text-muted">冲突：</dt><dd className="inline">{proposal.coreConflict}</dd></div><div><dt className="inline text-text-muted">开场：</dt><dd className="inline">{proposal.opening}</dd></div><div><dt className="inline text-text-muted">结构：</dt><dd className="inline">{proposal.structure}</dd></div></dl>
        <p className="mt-2 break-all text-[8px] leading-4 text-text-muted">来源：{proposal.sourceRefs.join(' · ')}</p>
      </article>)}
    </div>
    <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
      {TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2.map((section) => <div key={section} data-proposal-section={section} className="grid gap-1 rounded border border-border bg-bg-base p-2 text-[10px] text-text-muted">
        <span className="flex items-center justify-between gap-2"><strong className="text-text-primary">{SECTION_LABELS[section]}</strong><label className="flex items-center gap-1"><input type="checkbox" checked={props.value.selection.lockedSections.includes(section)} onChange={(event) => update(next => {
          next.selection.lockedSections = event.target.checked
            ? [...new Set([...next.selection.lockedSections, section])]
            : next.selection.lockedSections.filter(item => item !== section)
          next.selection.confirmed = false
        })} />锁定</label></span>
        <select aria-label={`${SECTION_LABELS[section]}来源提案`} disabled={props.value.selection.lockedSections.includes(section)} value={props.value.selection.sectionSources[section]} onChange={(event) => update(next => { next.selection.sectionSources[section] = event.target.value; next.selection.confirmed = false })} className="rounded border border-border bg-bg-elevated p-2 text-[10px] text-text-primary disabled:opacity-60">
          {props.value.proposals.map(proposal => <option key={proposal.proposalKey} value={proposal.proposalKey}>{proposal.title}</option>)}
        </select>
        {props.onGenerateAi && <button type="button" disabled={props.aiGenerating || !props.aiReady || props.value.selection.lockedSections.includes(section)} onClick={() => props.onGenerateAi?.([section])} className="rounded border border-purple-500/40 px-2 py-1 text-[9px] text-purple-600 disabled:opacity-40">只重生成{SECTION_LABELS[section]}</button>}
      </div>)}
    </div>
    <label className="mt-3 grid gap-1 text-[10px] text-text-muted">混合说明（会进入冻结 Brief）<textarea rows={2} maxLength={4000} value={props.value.selection.authorNotes} onChange={(event) => update(next => { next.selection.authorNotes = event.target.value; next.selection.confirmed = false })} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" placeholder="例如：保留证据网的秘密结构，但采用阵营压力的结局。" /></label>
    <label className="mt-3 flex items-start gap-2 rounded border border-accent/30 bg-bg-base p-3 text-[10px] text-text-muted"><input type="checkbox" className="mt-0.5" checked={props.value.selection.confirmed} onChange={(event) => update(next => { next.selection.confirmed = event.target.checked })} /><span><strong className="block text-text-primary">确认采用当前提案混合</strong>确认后才可授权 Build；改变任一分区来源或锁定项后，请重新检查并确认。</span></label>
  </section>
}
