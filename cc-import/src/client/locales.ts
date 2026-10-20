/**
 * cc-import Client 半的中英双语文案（经 `ctx.locale.register` 注册）。
 * 插值占位符 `{name}` 形态与 dsh client-locale 的 translate 实现一致。
 */
import type { LocaleBundles } from '@deepseek-ai/cordis'

/** 词典命名空间：cc-import 专属键域。 */
export const LOCALE_NS = 'cc-import'

export const localeBundles: LocaleBundles = {
  // 键加引号仅为源级断言稳定（验证场景以 ["']zh["'] 形态识别双语键）；
  // 运行时契约是 dsh-client-locale 的 zh/en locale 码，引号不改变语义。
  'zh': {
    'action.import': '从 Claude Code 导入',
    'dialog.title': '从 Claude Code 导入 provider',
    'dialog.description':
      '候选来自 cc-switch（~/.cc-switch/cc-switch.db）的 claude 形态 provider；导入经 dsh 官方写入路径，只加不删，密钥只进凭据库。',
    'dialog.refresh': '重新扫描',
    'dialog.selectAll': '全选新增',
    'dialog.deselectAll': '取消全部选择',
    'dialog.import': '导入所选（{count}）',
    'dialog.close': '关闭',
    'dialog.loading': '正在扫描 cc-switch…',
    'status.importable': '可导入',
    'status.existed': '已存在',
    'status.update': '将更新',
    'status.skipped': '跳过',
    'check.update': '将更新（覆盖该 route）',
    'skip.missing_base_url': '缺少 ANTHROPIC_BASE_URL',
    'skip.missing_token': '缺少 ANTHROPIC_AUTH_TOKEN',
    'skip.missing_model': '未配置模型（先在 cc-switch 补模型再导）',
    'model.contextWindow': '1M 上下文',
    'scan.empty': 'cc-switch 没有可导入的 claude provider',
    'scan.failed': '扫描失败：{message}',
    'import.running': '正在导入…',
    'import.done': '成功导入 {count} 个',
    'import.failures': '失败 {count} 个：',
    'import.fail.snapshot': 'settings 快照读取失败，已中止导入：{message}',
    'import.fail.route_taken':
      'route "{route}" 在导入期间被其他端创建，为避免覆盖已跳过（请刷新后重试）',
    'import.fail.keyref_taken':
      '凭据引用 "{ref}" 在导入期间被其他端创建的条目占用，为避免覆盖其 token 已跳过（请刷新后重试）',
    'import.fail.credential_rolled_back': '{message}（已回滚本轮写入的 provider 条目）',
    'import.fail.rollback_failed':
      '{message}（provider 条目回滚失败，Models 页可能留下无凭据条目，请重试导入：{error}）',
    'import.fail.plan_broken': '计划结构异常，本批导入中止',
  },
  'en': {
    'action.import': 'Import from Claude Code',
    'dialog.title': 'Import providers from Claude Code',
    'dialog.description':
      'Candidates come from the claude-shaped providers managed by cc-switch (~/.cc-switch/cc-switch.db). Imports go through the official dsh write path, append-only; keys live only in the credential store.',
    'dialog.refresh': 'Rescan',
    'dialog.selectAll': 'Select new',
    'dialog.deselectAll': 'Deselect all',
    'dialog.import': 'Import selected ({count})',
    'dialog.close': 'Close',
    'dialog.loading': 'Scanning cc-switch…',
    'status.importable': 'Importable',
    'status.existed': 'Already exists',
    'status.update': 'Will update',
    'status.skipped': 'Skip',
    'check.update': 'Will update (overwrite this route)',
    'skip.missing_base_url': 'Missing ANTHROPIC_BASE_URL',
    'skip.missing_token': 'Missing ANTHROPIC_AUTH_TOKEN',
    'skip.missing_model': 'No model configured (add one in cc-switch first)',
    'model.contextWindow': '1M context',
    'scan.empty': 'No importable claude provider in cc-switch',
    'scan.failed': 'Scan failed: {message}',
    'import.running': 'Importing…',
    'import.done': 'Imported {count}',
    'import.failures': '{count} failed:',
    'import.fail.snapshot': 'Failed to read the settings snapshot; import aborted: {message}',
    'import.fail.route_taken':
      'route "{route}" was created by another client during the import; skipped to avoid overwriting it (refresh and retry)',
    'import.fail.keyref_taken':
      'credential reference "{ref}" is occupied by an entry created during the import; skipped to avoid overwriting its token (refresh and retry)',
    'import.fail.credential_rolled_back': '{message} (the provider entry written in this run was rolled back)',
    'import.fail.rollback_failed':
      '{message} (failed to roll back the provider entry; the Models page may keep a credential-less entry, retry the import: {error})',
    'import.fail.plan_broken': 'Import plan structure error; the batch was terminated',
  },
}
