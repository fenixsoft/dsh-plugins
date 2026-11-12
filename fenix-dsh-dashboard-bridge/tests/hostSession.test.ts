/**
 * dashboard 内嵌页「新会话」请求通道单测（add-dsh-new-session-button，
 * 2026-11-11 用户需求）：
 * - parseHostNewSessionMessage 形状校验（kind 鉴别/形状异常吞）；
 * - installDashboardSessionRequests 装配契约：origin 门禁（跨源忽略）、
 *   命中 → startProjectSessionInner（已有工作区直启 / 无工作区建后启）、
 *   prompt 经 startSession 第二参预填（无 prompt = 无 draft options）、
 *   注销移除监听、window 缺席 no-op 降级；
 * - apply 装配源码钉（监听注册 + cleanup 注销，rightTab/locate 源码钉先例）。
 * window 以最小桩注入 globalThis（srcContract.test.ts withFakeWindow 先例）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOST_NEW_SESSION_KIND,
  installDashboardSessionRequests,
  parseHostNewSessionMessage,
} from '../src/client/index.js'

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 最小 window 桩：捕获 'message' 监听器，测试后摘除 globalThis.window。 */
function withFakeWindow(
  origin: string,
  run: (listeners: Array<(event: MessageEvent) => void>) => Promise<void> | void,
): Promise<void> {
  const listeners: Array<(event: MessageEvent) => void> = []
  const win = {
    location: { origin },
    addEventListener: (type: string, fn: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.push(fn)
    },
    removeEventListener: (type: string, fn: (event: MessageEvent) => void) => {
      const index = listeners.indexOf(fn)
      if (index >= 0) listeners.splice(index, 1)
    },
  }
  ;(globalThis as { window?: unknown }).window = win
  return Promise.resolve(run(listeners)).finally(() => {
    delete (globalThis as { window?: unknown }).window
  })
}

/** 最小 uiWorkspace/workspaces 桩：记录 startSession (id, draft) 与 create path。 */
function sessionCtx(items: readonly { workspaceId: string; path: string; title: string }[]) {
  const started: Array<[string | undefined, { prompt?: string } | undefined]> = []
  const createdPaths: string[] = []
  const ctx = {
    uiWorkspace: {
      workspaces: { list: { getSnapshot: () => ({ items }) } },
      startSession: (id?: string, draftOptions?: { prompt?: string }) => {
        started.push([id, draftOptions])
      },
    },
    workspaces: {
      create: async (input: { path: string }) => {
        createdPaths.push(input.path)
        return { workspaceId: 'w-new' }
      },
    },
  }
  return { ctx, started, createdPaths }
}

describe('parseHostNewSessionMessage：形状校验', () => {
  it('最小载荷 {kind, project} → { project }（无 prompt 键）', () => {
    expect(parseHostNewSessionMessage({ kind: HOST_NEW_SESSION_KIND, project: 'fenixd' })).toEqual({
      project: 'fenixd',
    })
    expect(
      parseHostNewSessionMessage({
        kind: HOST_NEW_SESSION_KIND,
        project: 'fenixd',
        prompt: '对于 add-foo SPEC：',
      }),
    ).toEqual({ project: 'fenixd', prompt: '对于 add-foo SPEC：' })
  })

  it('非对象 / kind 不符 / project 非串或空串 / prompt 非串 → null（吞）', () => {
    expect(parseHostNewSessionMessage(null)).toBeNull()
    expect(parseHostNewSessionMessage('fenix-dashboard:new-session')).toBeNull()
    expect(parseHostNewSessionMessage({ kind: 'other:kind', project: 'fenixd' })).toBeNull()
    expect(parseHostNewSessionMessage({ kind: HOST_NEW_SESSION_KIND, project: '' })).toBeNull()
    expect(parseHostNewSessionMessage({ kind: HOST_NEW_SESSION_KIND, project: 42 })).toBeNull()
    expect(
      parseHostNewSessionMessage({ kind: HOST_NEW_SESSION_KIND, project: 'fenixd', prompt: 1 }),
    ).toBeNull()
  })

  it('HOST_NEW_SESSION_KIND 钉值（dashboard 侧 embedBridge.ts 镜像字面量，改一侧必改另一侧）', () => {
    expect(HOST_NEW_SESSION_KIND).toBe('fenix-dashboard:new-session')
  })
})

describe('installDashboardSessionRequests：装配契约', () => {
  it('origin 门禁：跨源消息忽略，同源命中直启已有工作区', async () =>
    withFakeWindow('http://127.0.0.1:3080', async (listeners) => {
      const { ctx, started } = sessionCtx([
        { workspaceId: 'w1', path: '/root/fenixd', title: 'fenixd' },
      ])
      const stop = installDashboardSessionRequests(ctx as never, '/fenix-dashboard/')
      const dispatch = (origin: string, data: unknown): void => {
        for (const fn of listeners) fn({ origin, data } as unknown as MessageEvent)
      }
      dispatch('https://evil.example', { kind: HOST_NEW_SESSION_KIND, project: 'fenixd' })
      await flush()
      expect(started).toEqual([])
      dispatch('http://127.0.0.1:3080', { kind: HOST_NEW_SESSION_KIND, project: 'fenixd' })
      await flush()
      // 无 prompt：startSession(id) 且无 draft options（原生空白新会话）。
      expect(started).toEqual([['w1', undefined]])
      stop()
    }))

  it('prompt 经 startSession 第二参预填（「对于 XXXX SPEC：」前缀落输入框）', async () =>
    withFakeWindow('http://127.0.0.1:3080', async (listeners) => {
      const { ctx, started } = sessionCtx([
        { workspaceId: 'w1', path: '/root/fenixd', title: 'fenixd' },
      ])
      const stop = installDashboardSessionRequests(ctx as never, '/fenix-dashboard/')
      for (const fn of listeners) {
        fn({
          origin: 'http://127.0.0.1:3080',
          data: { kind: HOST_NEW_SESSION_KIND, project: 'fenixd', prompt: '对于 add-foo SPEC：' },
        } as unknown as MessageEvent)
      }
      await flush()
      expect(started).toEqual([['w1', { prompt: '对于 add-foo SPEC：' }]])
      stop()
    }))

  it('无对应工作区：按目录建工作区后启会话（prompt 一并携带）；目录不可得降级不外溢', async () =>
    withFakeWindow('http://127.0.0.1:3080', async (listeners) => {
      const { ctx, started, createdPaths } = sessionCtx([])
      const stop = installDashboardSessionRequests(ctx as never, '/fenix-dashboard/', {
        fetchProjectPath: (name) =>
          Promise.resolve(name === 'newproj' ? '/root/newproj' : null),
      })
      const dispatch = (data: unknown): void => {
        for (const fn of listeners) {
          fn({ origin: 'http://127.0.0.1:3080', data } as unknown as MessageEvent)
        }
      }
      dispatch({
        kind: HOST_NEW_SESSION_KIND,
        project: 'newproj',
        prompt: '对于 newproj SPEC：',
      })
      await flush()
      expect(createdPaths).toEqual(['/root/newproj'])
      expect(started).toEqual([['w-new', { prompt: '对于 newproj SPEC：' }]])
      started.length = 0
      // 未注册项目（exists=false）→ warn 降级，不建不启，无未处理异常。
      expect(() => dispatch({ kind: HOST_NEW_SESSION_KIND, project: 'ghost' })).not.toThrow()
      await flush()
      expect(started).toEqual([])
      stop()
    }))

  it('注销移除 message 监听（幂等安全）；形状异常消息（project 非串）被吞', async () =>
    withFakeWindow('http://127.0.0.1:3080', async (listeners) => {
      const { ctx, started } = sessionCtx([
        { workspaceId: 'w1', path: '/root/fenixd', title: 'fenixd' },
      ])
      const stop = installDashboardSessionRequests(ctx as never, '/fenix-dashboard/')
      stop()
      stop()
      expect(listeners).toEqual([])
      for (const fn of listeners) {
        fn({
          origin: 'http://127.0.0.1:3080',
          data: { kind: HOST_NEW_SESSION_KIND, project: 'fenixd' },
        } as unknown as MessageEvent)
      }
      await flush()
      expect(started).toEqual([])
    }))

  it('window 缺席（node 环境）：no-op 降级注册，注销函数幂等', () => {
    // withFakeWindow 已在 finally 摘除 window；此处 window === undefined。
    const { ctx } = sessionCtx([])
    expect(() => {
      const stop = installDashboardSessionRequests(ctx as never, '/fenix-dashboard/')
      stop()
      stop()
    }).not.toThrow()
  })

  it('apply 装配源码钉：注册 installDashboardSessionRequests(ctx, prefix) + cleanup stop', () => {
    const src = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(src).toContain('installDashboardSessionRequests(ctx, prefix)')
    expect(src).toContain('stopHostSessionRequests()')
  })
})
