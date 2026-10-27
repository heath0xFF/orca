import { describe, expect, it } from 'vitest'
import { structuredAgentCommandTokens } from './tui-agent-launch-command-override'

describe('structured agent command tokens', () => {
  it.each([
    ['claude-nightly', 'claude-nightly'],
    ['/opt/tools/claude', '/opt/tools/claude'],
    ['"/opt/my tools/claude"', '/opt/my tools/claude'],
    [String.raw`/opt/my\ tools/claude`, '/opt/my tools/claude'],
    [
      String.raw`"C:\Program Files\Claude\claude.exe"`,
      String.raw`C:\Program Files\Claude\claude.exe`
    ],
    ['~/bin/codex', '~/bin/codex']
  ])('accepts one literal executable %s', (input, token) => {
    expect(structuredAgentCommandTokens(input)).toEqual([token])
  })

  it.each([
    ['agent-launcher pi', ['agent-launcher', 'pi']],
    [
      'agent-launcher --profile "work account" pi',
      ['agent-launcher', '--profile', 'work account', 'pi']
    ],
    ['"/opt/my tools/launcher" pi', ['/opt/my tools/launcher', 'pi']],
    ['launcher "" pi', ['launcher', '', 'pi']]
  ])('preserves literal prefix arguments: %s', (input, tokens) => {
    expect(structuredAgentCommandTokens(input)).toEqual(tokens)
  })

  it('preserves Windows argument paths even when the executable is a bare name', () => {
    expect(
      structuredAgentCommandTokens(
        String.raw`launcher --config "C:\Users\dev\work config" pi`,
        'win32'
      )
    ).toEqual(['launcher', '--config', String.raw`C:\Users\dev\work config`, 'pi'])
  })

  it.each([
    '',
    '"" pi',
    'launcher pi && other',
    'launcher $AGENT',
    'launcher pi # comment',
    'launcher pi *',
    'launcher pi\0',
    'claude;codex',
    '$CLI',
    '"$HOME/bin/claude"',
    '`which claude`',
    'claude | cat',
    'claude\ncodex',
    '"unfinished'
  ])('rejects shell syntax %s', (command) => {
    expect(structuredAgentCommandTokens(command)).toBeNull()
  })
})
