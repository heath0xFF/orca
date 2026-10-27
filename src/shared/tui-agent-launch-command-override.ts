import type { GlobalSettings } from './global-settings-types'
import type { TuiAgent } from './tui-agent'
import { tokenizeCustomCommandTemplate } from './commit-message-prompt'

// Keep wrapper arguments literal; structured launches never evaluate shell syntax.
export function structuredAgentCommandTokens(
  command: string,
  platform?: NodeJS.Platform
): string[] | null {
  const input = command.trim()
  if (!input || /[\0\r\n$`]/.test(input)) {
    return null
  }
  const windowsPath = /^(?:["']?)(?:[A-Za-z]:[\\/]|\\\\)/.test(input)
  const parsed = tokenizeCustomCommandTemplate(
    input,
    windowsPath || platform === 'win32' ? 'literal' : 'escape'
  )
  if (
    !parsed.ok ||
    !parsed.tokens[0] ||
    parsed.spans.some((span) => span.divergesFromShell) ||
    parsed.tokens.some((token) => /[|&;<>(){}[\]*?!]/.test(token))
  ) {
    return null
  }
  return parsed.tokens
}

/** Terminal-backed chat skips the structured catalog when its launch command is customized. */
export function hasExplicitTuiLaunchCommand(
  settings: Partial<Pick<GlobalSettings, 'agentCmdOverrides'>> | null | undefined,
  agent: TuiAgent
): boolean {
  return Boolean(settings?.agentCmdOverrides?.[agent]?.trim())
}
