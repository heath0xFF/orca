import { delimiter, isAbsolute, resolve as resolvePath } from 'node:path'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  resolveCliCommand,
  resolveExecutableCommand
} from '../../shared/node-cli-command-resolution'
import {
  hasExplicitTuiLaunchCommand,
  structuredAgentCommandTokens
} from '../../shared/tui-agent-launch-command-override'
import {
  AgentSessionPreSpawnError,
  isAgentSessionPreSpawnError
} from './agent-session-wire/structured-agent-session-adapter'
import { guestNativePathEnv } from '../ipc/wsl-guest-windows-drive-path'

export type StructuredAgentCommandSettings = Partial<
  Pick<GlobalSettings, 'agentCmdOverrides' | 'agentDefaultEnv'>
>
type CommandSettings = StructuredAgentCommandSettings
type CommandOptions = NonNullable<Parameters<typeof resolveExecutableCommand>[1]>

export type StructuredAgentInvocation = { command: string; prefixArgs?: readonly string[] }

function commandNotRunnable(agent: TuiAgent): AgentSessionPreSpawnError {
  return new AgentSessionPreSpawnError(`the ${agent} Command setting is not a runnable program`, {
    reason: 'agentCommandNotRunnable'
  })
}

// Extensionless commands cannot spawn on Windows; .cmd/.bat use Orca’s shim handling.
function spawnableOn(platform: NodeJS.Platform, command: string): boolean {
  return platform !== 'win32' || /\.(exe|com|cmd|bat)$/i.test(command)
}

/** Read live settings on every lookup; invalid explicit commands must refuse instead of launching stock CLI. */
export function resolveStructuredAgentCommand(
  agent: TuiAgent,
  settings: CommandSettings,
  options: CommandOptions = {},
  stock: { command?: string; resolve?: typeof resolveCliCommand } = {}
): string {
  const invocation = resolveStructuredAgentInvocation(agent, settings, options, stock)
  // Adapters that accept only an executable must not silently discard wrapper arguments.
  if (invocation.prefixArgs?.length) {
    throw commandNotRunnable(agent)
  }
  return invocation.command
}

export function resolveStructuredAgentInvocation(
  agent: TuiAgent,
  settings: CommandSettings,
  options: CommandOptions = {},
  stock: { command?: string; resolve?: typeof resolveCliCommand } = {}
): StructuredAgentInvocation {
  if (!hasExplicitTuiLaunchCommand(settings, agent)) {
    // WSL PATH may contain drive-mounted Windows shims after native entries.
    const pathEnv = guestNativePathEnv(options.pathEnv)
    return {
      command: (stock.resolve ?? resolveCliCommand)(
        stock.command ?? agent,
        pathEnv === options.pathEnv ? options : { ...options, pathEnv }
      )
    }
  }
  const platform = options.platform ?? process.platform
  const tokens = structuredAgentCommandTokens(settings.agentCmdOverrides?.[agent] ?? '', platform)
  const overlay = settings.agentDefaultEnv?.[agent]
  const command = tokens
    ? resolveExecutableCommand(tokens[0], {
        ...options,
        pathEnv: guestNativePathEnv(options.pathEnv ?? overlay?.PATH ?? overlay?.Path)
      })
    : null
  if (!command || !spawnableOn(platform, command)) {
    throw commandNotRunnable(agent)
  }
  const prefixArgs = tokens?.slice(1)
  return { command, ...(prefixArgs?.length ? { prefixArgs } : {}) }
}

export type ProgramSearch<T> = {
  env: (resolved: T) => NodeJS.ProcessEnv | undefined
  cwd?: () => Promise<string> | string
}

/** Bare names may resolve only at spawn through a relative PATH entry under the launch cwd. */
async function foundNothing<T extends { command: string }>(
  resolved: T,
  search: ProgramSearch<T>
): Promise<boolean> {
  if (isAbsolute(resolved.command) || /[\\/]/.test(resolved.command)) {
    return false
  }
  const env = search.env(resolved)
  const relative = (env?.PATH ?? env?.Path ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !isAbsolute(entry))
  if (relative.length === 0) {
    return true
  }
  const from = (await search.cwd?.()) ?? process.cwd()
  const found = resolveCliCommand(resolved.command, {
    pathEnv: relative.map((entry) => resolvePath(from, entry)).join(delimiter),
    homePath: env?.HOME ?? env?.USERPROFILE
  })
  return !isAbsolute(found)
}

/** On a miss, await a shell refresh started after this lookup and retry once; found programs never wait. */
export async function resolveAgainAfterRefreshOnMissingProgram<T extends { command: string }>(
  resolve: () => Promise<T>,
  refreshAfterMiss: ((askedAt: number) => Promise<void>) | undefined,
  search: ProgramSearch<T>
): Promise<T> {
  if (!refreshAfterMiss) {
    return resolve()
  }
  const askedAt = Date.now()
  try {
    const resolved = await resolve()
    if (!(await foundNothing(resolved, search))) {
      return resolved
    }
  } catch (error) {
    if (!isAgentSessionPreSpawnError(error) || error.reason !== 'agentCommandNotRunnable') {
      throw error
    }
  }
  await refreshAfterMiss(askedAt)
  return resolve()
}
