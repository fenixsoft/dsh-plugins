# ADR-005：LLM 流式调用超时必须 Promise.race 硬解耦，不依赖底层流闭合

date: 2026-11-13
status: accepted

## Context

pi-ai / 底层 LLM SDK 的惰性流在 pending 状态不观察 abort 信号：AbortController deadline 到点 abort 后，`for await` 消费循环仍永不返回，await 流消费的调用方继续悬挂。会话高级搜索曾因此实证卡死约 3.5 分钟——建立在「signal 会被底层流观察」假设上的超时守卫形同虚设。

## Decision

对 LLM 流式调用的端到端限时控制必须用 Promise.race 把流消费 promise 与超时 marker / 外部取消哨兵竞速：deadline 到点 race 必定结算并立即返回降级结果，绝不等待底层流闭合；败者流 promise 必须挂 .catch 吸收错误，杜绝 unhandled rejection；外部取消（任务 DELETE）优先级高于超时（不降级不产出）。凭证预检等快速失败机制只能作为可选优化层，探针缺失或形状漂移时跳过预检不误杀，正确性一律由该硬超时兜底。

## Consequences

超时上限成为真实硬上限（上限 + 小余量内必有结果）。代价是超时后底层流可能仍在后台消耗资源直至自然失败或闭合，由 .catch 吸收；后续任何触及 LLM 调用路径的实现都必须保持竞速结构，不得「简化」回裸 await 流消费。
