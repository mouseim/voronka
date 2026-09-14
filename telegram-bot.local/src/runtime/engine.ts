import { randomBytes } from 'node:crypto'
import {
  applyVariableOperations,
  calculateTestResult,
  evaluateCondition,
  initialVariableValues,
  renderVariableTemplate,
  type ConditionData,
  type ConsentData,
  type ExternalLinkData,
  type FormData,
  type FunnelDocument,
  type FunnelNode,
  type FunnelTest,
  type MediaData,
  type MessageData,
  type Product,
  type ProductBlockData,
  type ResultButton,
  type TestQuestion,
  type TimerData,
  type VariableData,
} from '../core/shared'
import { branchButtons, outgoingNodeId, splitTelegramText, stableShuffle, timerDelayMs } from '../core/semantics'
import type {
  CallbackAction,
  DurableJob,
  FunnelVersionRecord,
  OutgoingButton,
  PaymentRecord,
  ProductRuntimeConfig,
  RuntimeSession,
  RuntimeTransport,
  RuntimeUser,
  PlatformProfile,
} from '../domain/types'
import { applyQuietHours } from './quiet-hours'
import { unsupportedReachableCapability } from './capabilities'
import type { RuntimeStore } from './store'
import { paymentProviderFor } from '../payments/providers'

interface EngineOptions {
  publicBaseUrl?: string | null
  paymentProviderToken?: string
  now?: () => Date
  automaticTransitionLimit?: number
  recoveryDelayMs?: number
}

export class FunnelEngine {
  private readonly now: () => Date
  private readonly transitionLimit: number
  private readonly recoveryDelayMs: number

  constructor(
    private readonly store: RuntimeStore,
    private readonly transport: RuntimeTransport,
    private readonly options: EngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.transitionLimit = options.automaticTransitionLimit ?? 50
    this.recoveryDelayMs = options.recoveryDelayMs ?? 30_000
  }

  async start(profile: PlatformProfile, trackingCode?: string): Promise<void> {
    this.assertProfilePlatform(profile)
    const user = await this.store.upsertUser(profile)
    const resolved = await this.store.resolveVersion(trackingCode)
    if (!resolved) {
      await this.transport.sendText(user.externalUserId, trackingCode
        ? 'Эта ссылка устарела или воронка ещё не опубликована.'
        : 'Администратор ещё не опубликовал основную воронку.')
      return
    }
    const { version, trackingId } = resolved
    const document = version.document
    const unsupported = unsupportedReachableCapability(document, this.transport.capabilities)
    if (unsupported) {
      await this.transport.sendText(user.externalUserId, `Эта воронка использует неподдерживаемую на ${this.transport.platform} возможность: ${unsupported}.`)
      throw new Error(`UNSUPPORTED_PLATFORM_CAPABILITY:${this.transport.platform}:${unsupported}`)
    }
    if (user.optedOutAt) {
      if (!document.bot.optOut.allowRestart) {
        await this.transport.sendText(user.externalUserId, 'Повторный запуск отключён настройками этой воронки.')
        return
      }
      await this.store.setOptOut(user.id, false, false)
      user.optedOutAt = null
      user.backgroundBlocked = false
    }

    let session = await this.store.findActiveSession(user.id, version.funnelId)
    if (session && document.bot.reentryPolicy === 'restart') {
      await this.store.abandonSession(session.id)
      await this.store.cancelSessionJobs(session.id)
      session = null
    }
    if (session && document.bot.reentryPolicy === 'show_result' && session.state.lastResultName) {
      const restart = await this.store.createCallback(user.id, session.id, { type: 'restart', funnelId: session.funnelId })
      await this.transport.sendText(user.externalUserId, `Ваш последний результат: ${session.state.lastResultName}`, [
        [{ text: 'Продолжить', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId: session.currentNodeId ?? '', handle: '__resume' }) }],
        [{ text: 'Пройти заново', callbackToken: restart }],
      ])
      return
    }
    if (!session && document.bot.reentryPolicy === 'show_result') {
      const latest = await this.store.findLatestSession(user.id, version.funnelId)
      if (latest?.state.lastResultName) {
        const restart = await this.store.createCallback(user.id, latest.id, { type: 'restart', funnelId: latest.funnelId })
        await this.transport.sendText(user.externalUserId, `Ваш последний результат: ${latest.state.lastResultName}`, [
          [{ text: 'Пройти заново', callbackToken: restart }],
        ])
        return
      }
    }
    if (!session) {
      session = await this.store.createSession({
        userId: user.id,
        funnelId: version.funnelId,
        versionId: version.id,
        status: 'active',
        currentNodeId: document.funnel.startNodeId,
        sourceTrackingId: trackingId,
        sourceCode: trackingCode,
        state: { platform: user.platform, variables: initialVariableValues(version.document.variables) },
      })
      await this.scheduleRecovery(session)
      await this.event(session, 'session_started', { trackingCode }, 'start')
      if (trackingId) await this.event(session, 'source_attributed', { trackingCode }, `source:${trackingId}`)
    }
    await this.run(user, session)
  }

  async stop(profile: PlatformProfile): Promise<void> {
    this.assertProfilePlatform(profile)
    const user = await this.store.upsertUser(profile)
    const resolved = await this.store.resolveVersion()
    await this.stopUser(user, resolved?.version.document)
  }

  async handleOptOutCommand(profile: PlatformProfile, text: string): Promise<boolean> {
    this.assertProfilePlatform(profile)
    const existingUser = await this.store.getUserByPlatformIdentity(profile.platform, profile.externalUserId)
    const session = existingUser ? await this.store.findAnyActiveSession(existingUser.id) : null
    const version = session ? await this.requireVersion(session.versionId) : (await this.store.resolveVersion())?.version
    const configured = normalizeTelegramCommand(version?.document.bot.optOut.command) ?? '/stop'
    if (normalizeTelegramCommand(text) !== configured) return false
    const user = existingUser ?? await this.store.upsertUser(profile)
    await this.stopUser(user, version?.document)
    return true
  }

  private async stopUser(user: RuntimeUser, document?: FunnelDocument): Promise<void> {
    await this.store.setOptOut(user.id, true, document?.bot.optOut.blockBackground ?? true)
    const sessionIds = await this.store.stopUserSessions(user.id)
    await Promise.all(sessionIds.map((sessionId) => this.store.cancelSessionJobs(sessionId)))
    await this.store.appendEvent({
      idempotencyKey: `optout:${user.id}:${this.now().toISOString().slice(0, 16)}`,
      type: 'opted_out',
      userId: user.id,
      payload: {},
    })
    await this.transport.sendText(user.externalUserId, document?.bot.optOut.confirmationText || 'Вы отписались от фоновых сообщений.')
  }

  async handleCallback(profile: PlatformProfile, token: string): Promise<boolean> {
    this.assertProfilePlatform(profile)
    const user = await this.store.upsertUser(profile)
    const callback = await this.store.consumeCallback(token, user.id)
    if (!callback) {
      await this.transport.sendText(user.externalUserId, user.platform === 'telegram'
        ? 'Эта кнопка уже использована или устарела. Отправьте /start, чтобы продолжить.'
        : 'Эта кнопка уже использована или устарела. Напишите «Начать», чтобы продолжить.')
      return false
    }
    if (callback.action.type === 'restart') {
      const active = await this.store.findActiveSession(user.id, callback.action.funnelId)
      const origin = active ?? (callback.sessionId ? await this.store.getSession(callback.sessionId) : null)
      const sourceTrackingId = origin?.sourceTrackingId
      const sourceCode = origin?.sourceCode
      if (active) {
        await this.store.abandonSession(active.id)
        await this.store.cancelSessionJobs(active.id)
      }
      const version = await this.store.resolveVersionByFunnel(callback.action.funnelId)
      if (!version) {
        await this.transport.sendText(user.externalUserId, 'Эта воронка больше не опубликована.')
        return false
      }
      const restarted = await this.store.createSession({
        userId: user.id,
        funnelId: version.funnelId,
        versionId: version.id,
        status: 'active',
        currentNodeId: version.document.funnel.startNodeId,
        sourceTrackingId,
        sourceCode,
        state: { platform: user.platform, variables: initialVariableValues(version.document.variables) },
      })
      await this.scheduleRecovery(restarted)
      await this.event(restarted, 'session_started', { restarted: true }, 'restart')
      await this.run(user, restarted)
      return true
    }
    if (!callback.sessionId) return false
    let session = await this.store.getSession(callback.sessionId)
    if (!session || !['active', 'waiting'].includes(session.status)) {
      await this.transport.sendText(user.externalUserId, 'Это прохождение уже завершено.')
      return false
    }
    const version = await this.requireVersion(session.versionId)
    const action = callback.action
    if ('nodeId' in action && action.nodeId !== session.currentNodeId) {
      await this.transport.sendText(user.externalUserId, 'Эта кнопка относится к предыдущему этапу и больше не действует.')
      return false
    }
    if (version.document.bot.reminders.cancelAfterContinue) {
      await this.store.cancelSessionJobs(session.id, ['reminder'])
    }

    if (action.type === 'advance') {
      if (action.handle === '__resume') return this.run(user, session).then(() => true)
      session = await this.advanceAndSave(session, version.document, action.nodeId, action.handle)
      await this.run(user, session)
      return true
    }
    if (action.type === 'test_single' || action.type === 'test_value' || action.type === 'test_skip') {
      session = await this.applyTestAnswer(session, version.document, action)
      await this.continueTest(user, session, version)
      return true
    }
    if (action.type === 'test_toggle') {
      const run = session.state.testRun
      if (!run || run.questionOrder[run.index] !== action.questionId) return false
      run.selected = run.selected.includes(action.answerId)
        ? run.selected.filter((id) => id !== action.answerId)
        : [...run.selected, action.answerId]
      session = await this.save(session)
      await this.askTestQuestion(user, session, version)
      return true
    }
    if (action.type === 'test_submit') {
      const run = session.state.testRun
      const question = this.currentQuestion(version.document, run)
      if (!run || !question || question.id !== action.questionId) return false
      if (question.required && !run.selected.length) {
        await this.transport.sendText(user.externalUserId, 'Выберите хотя бы один вариант.')
        return false
      }
      session = await this.applyTestAnswer(session, version.document, {
        type: 'test_single',
        nodeId: action.nodeId,
        testId: action.testId,
        questionId: action.questionId,
        answerId: '__multiple__',
      }, run.selected)
      await this.continueTest(user, session, version)
      return true
    }
    if (action.type === 'form_cancel') {
      session.state.formRun = undefined
      await this.event(session, 'form_cancelled', {}, `form_cancel:${session.revision}`)
      session = await this.advanceAndSave(session, version.document, action.nodeId, 'cancelled')
      await this.run(user, session)
      return true
    }
    if (action.type === 'consent') {
      const node = this.requireCurrentNode(version.document, session)
      const data = node.data as ConsentData
      await this.store.saveConsent(session, node.id, action.accepted, data.policyUrl, data.text)
      await this.event(session, action.accepted ? 'consent_given' : 'consent_declined', {}, `consent:${node.id}:${action.accepted}`)
      if (action.accepted && session.state.pendingFormSubmission) {
        await this.persistApplication(user, session, session.state.pendingFormSubmission.values)
      }
      session.state.pendingFormSubmission = undefined
      session = await this.advanceAndSave(session, version.document, action.nodeId, action.accepted ? 'accepted' : 'declined')
      await this.run(user, session)
      return true
    }
    if (action.type === 'product_skip') {
      await this.event(session, 'payment_failed', { reason: 'skipped' }, `product_skip:${session.revision}`)
      session = await this.advanceAndSave(session, version.document, action.nodeId, 'skip')
      await this.run(user, session)
      return true
    }
    if (action.type === 'product_buy') {
      await this.beginProductPurchase(user, session, version, action.productId)
      return true
    }
    if (action.type === 'mock_payment') {
      const payment = await this.store.getPaymentByPayload(`mock:${action.paymentId}`)
      if (!payment) return false
      await this.finishPayment(user, payment, `mock_${action.paymentId}`)
      return true
    }
    return false
  }

  async handleText(profile: PlatformProfile, text: string): Promise<boolean> {
    this.assertProfilePlatform(profile)
    const user = await this.store.upsertUser(profile)
    const session = await this.store.findAnyActiveSession(user.id)
    if (!session) {
      await this.transport.sendText(user.externalUserId, user.platform === 'telegram'
        ? 'Сейчас нет активного прохождения. Отправьте /start.'
        : 'Сейчас нет активного прохождения. Напишите «Начать».')
      return false
    }
    const version = await this.requireVersion(session.versionId)
    if (version.document.bot.reminders.cancelAfterContinue) {
      await this.store.cancelSessionJobs(session.id, ['reminder'])
    }
    if (session.state.testRun) return this.handleTestText(user, session, version, text)
    if (session.state.formRun) return this.handleFormText(user, session, version, text)
    await this.transport.sendText(user.externalUserId, 'Используйте кнопки под последним сообщением.')
    return false
  }

  async validatePreCheckout(payload: string, amountMinor: number, currency: string): Promise<{ ok: boolean; message?: string }> {
    const payment = await this.store.getPaymentByPayload(payload)
    if (!payment || !['pending', 'paid'].includes(payment.status)) return { ok: false, message: 'Счёт устарел или уже обработан.' }
    if (payment.amountMinor !== amountMinor || payment.currency !== currency) return { ok: false, message: 'Цена или валюта счёта изменилась.' }
    const config = await this.store.getProductConfig(payment.versionId, payment.productId)
    if (!config || config.provider !== payment.provider || config.amountMinor !== amountMinor || config.currency !== currency) {
      return { ok: false, message: 'Настройки продукта изменились. Откройте предложение заново.' }
    }
    return { ok: true }
  }

  async handleSuccessfulPayment(profile: PlatformProfile, input: { payload: string; amountMinor: number; currency: string; telegramChargeId: string; providerChargeId?: string }): Promise<boolean> {
    this.assertProfilePlatform(profile)
    const user = await this.store.upsertUser(profile)
    const check = await this.validatePreCheckout(input.payload, input.amountMinor, input.currency)
    if (!check.ok) {
      await this.transport.sendText(user.externalUserId, check.message ?? 'Не удалось подтвердить платёж.')
      return false
    }
    const payment = await this.store.getPaymentByPayload(input.payload)
    if (!payment || payment.userId !== user.id) return false
    await this.finishPayment(user, payment, input.telegramChargeId, input.providerChargeId)
    return true
  }

  async handleRedirect(token: string): Promise<string | null> {
    const redirect = await this.store.consumeRedirect(token)
    if (!redirect) return null
    const session = await this.store.getSession(redirect.sessionId)
    if (session) {
      await this.event(session, 'external_link_clicked', { targetHost: new URL(redirect.targetUrl).host }, `redirect:${token}`)
      if (redirect.continueAfterClick) {
        const version = await this.requireVersion(session.versionId)
        await this.store.scheduleJob({
          uniqueKey: `redirect:${token}`,
          type: 'redirect_continue',
          payload: {
            sessionId: session.id,
            nodeId: session.currentNodeId,
            targetNodeId: session.currentNodeId
              ? outgoingNodeId(version.document, session.currentNodeId, 'next')
              : null,
          },
          dueAt: this.now().toISOString(),
          maxAttempts: 5,
        })
      }
    }
    return redirect.targetUrl
  }

  async handleJob(job: DurableJob): Promise<void> {
    const sessionId = String(job.payload.sessionId ?? '')
    let session = await this.store.getSession(sessionId)
    if (!session || !['active', 'waiting'].includes(session.status)) return
    const user = await this.store.getUser(session.userId)
    if (!user || user.backgroundBlocked) return
    const version = await this.requireVersion(session.versionId)
    if (job.type === 'resume_session') {
      const expectedNode = String(job.payload.nodeId ?? '')
      if (session.currentNodeId === expectedNode && session.status === 'active') await this.run(user, session)
      return
    }
    if (job.type === 'timer_continue' || job.type === 'redirect_continue') {
      const expectedNode = String(job.payload.nodeId ?? '')
      const targetNode = String(job.payload.targetNodeId ?? '')
      if (session.currentNodeId === targetNode && session.status === 'active') {
        await this.run(user, session)
        return
      }
      if (session.currentNodeId !== expectedNode) return
      session = await this.advanceAndSave(session, version.document, expectedNode, 'next')
      await this.run(user, session)
      return
    }
    if (job.type === 'reminder') {
      const expectedNode = String(job.payload.nodeId ?? '')
      const count = Number(job.payload.count ?? 1)
      if (session.currentNodeId !== expectedNode || session.status !== 'waiting') return
      const text = String(job.payload.text ?? 'Продолжим? Ваш результат и ответы сохранены.')
      await this.transport.sendText(user.externalUserId, text)
      await this.event(session, 'reminder_sent', { count }, `reminder:${expectedNode}:${count}`)
      session.state.remindersSent = count
      await this.save(session)
      const maximum = Number(job.payload.maximum ?? 1)
      if (count < maximum) {
        const nextDue = applyQuietHours(
          new Date(this.now().getTime() + 2 * 3_600_000),
          version.document,
          version.document.bot.reminders.respectQuietHours,
        )
        if (nextDue.date) {
          await this.store.scheduleJob({
            uniqueKey: `reminder:${session.id}:${expectedNode}:${session.revision}:${count + 1}`,
            type: 'reminder',
            payload: { ...job.payload, count: count + 1 },
            dueAt: nextDue.date.toISOString(),
            maxAttempts: 5,
          })
        }
      }
    }
  }

  private async run(user: RuntimeUser, initialSession: RuntimeSession): Promise<void> {
    let session = initialSession
    const version = await this.requireVersion(session.versionId)
    const document = version.document
    if (!session.state.variables) session.state.variables = initialVariableValues(document.variables)
    for (let automatic = 0; automatic < this.transitionLimit; automatic += 1) {
      if (!session.currentNodeId) return
      const node = this.requireCurrentNode(document, session)
      await this.enterNode(session, node)

      if (node.type === 'start') {
        session = await this.advanceInMemory(session, document, node.id, 'next')
        continue
      }
      if (node.type === 'media') {
        await this.sendNodeMedia(user, session, version, node)
        session = await this.advanceInMemory(session, document, node.id, 'next')
        continue
      }
      if (node.type === 'variable') {
        const before = session.state.variables ?? initialVariableValues(document.variables)
        session.state.variables = applyVariableOperations(document.variables, before, (node.data as VariableData).operations)
        await this.event(session, 'variables_changed', { before, after: session.state.variables }, `variables:${node.id}:${session.revision}`)
        session = await this.advanceAndSave(session, document, node.id, 'next')
        continue
      }
      if (node.type === 'condition') {
        const matched = evaluateCondition(document.variables, session.state.variables ?? initialVariableValues(document.variables), node.data as ConditionData)
        await this.event(session, 'condition_evaluated', { matched }, `condition:${node.id}:${session.revision}`)
        session = await this.advanceAndSave(session, document, node.id, matched ? 'true' : 'false')
        continue
      }
      if (node.type === 'message') {
        await this.sendMessageNode(user, session, version, node)
        return
      }
      if (node.type === 'timer') {
        await this.scheduleTimer(session, document, node)
        session.status = 'waiting'
        session.state.awaiting = 'timer'
        await this.save(session)
        return
      }
      if (node.type === 'test') {
        await this.beginOrContinueTest(user, session, version, node)
        return
      }
      if (node.type === 'form') {
        await this.beginOrContinueForm(user, session, version, node)
        return
      }
      if (node.type === 'consent') {
        await this.sendConsent(user, session, document, node)
        await this.scheduleReminder(session, document, 'stage')
        session.status = 'waiting'
        session.state.awaiting = 'callback'
        await this.save(session)
        return
      }
      if (node.type === 'product') {
        await this.sendProductNode(user, session, version, node)
        return
      }
      if (node.type === 'external_link') {
        await this.sendExternalLink(user, session, document, node)
        session.status = 'waiting'
        session.state.awaiting = 'callback'
        await this.save(session)
        return
      }
      if (node.type === 'end') {
        const text = String((node.data as { text?: string }).text ?? '')
        await this.sendText(user.externalUserId, this.render(document, session, text))
        session.status = 'completed'
        session.currentNodeId = null
        session.state.awaiting = undefined
        await this.store.cancelSessionJobs(session.id, ['reminder'])
        await this.event(session, 'node_completed', {}, `node_complete:${node.id}:${session.revision}`)
        await this.event(session, 'session_completed', {}, `complete:${session.revision}`)
        await this.save(session)
        return
      }
    }
    session.status = 'failed'
    await this.event(session, 'runtime_error', { code: 'AUTOMATIC_TRANSITION_LIMIT' }, `limit:${session.revision}`)
    await this.save(session)
    await this.transport.sendText(user.externalUserId, 'Сценарий остановлен из-за ошибки связей. Администратор уже уведомлён.')
    await this.transport.notifyAdministrators(`Runtime остановил воронку ${document.funnel.key} v${document.funnel.version}: превышен лимит автоматических переходов.`)
  }

  private async sendMessageNode(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, node: FunnelNode) {
    const data = node.data as MessageData
    const rows: OutgoingButton[][] = []
    const branches = branchButtons(data.buttons)
    for (const button of data.buttons) {
      if (button.action === 'branch') {
        rows.push([{ text: this.render(version.document, session, button.text), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId: node.id, handle: button.id }) }])
      } else if (button.action === 'url' && button.url) {
        rows.push([{ text: this.render(version.document, session, button.text), url: await this.safeActionUrl(user, session, button.url, false) }])
      } else if (button.action === 'product' && button.productId) {
        rows.push([{ text: this.render(version.document, session, button.text), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'product_buy', nodeId: node.id, productId: button.productId }) }])
      }
    }
    if (!branches.length) rows.push([{ text: 'Продолжить', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId: node.id, handle: 'next' }) }])
    await this.sendText(user.externalUserId, this.render(version.document, session, data.text), rows)
    session.status = 'waiting'
    session.state.awaiting = 'callback'
    await this.scheduleReminder(session, version.document, 'stage')
    await this.save(session)
  }

  private async sendNodeMedia(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, node: FunnelNode) {
    const data = node.data as MediaData
    const asset = version.document.assets.find((item) => item.id === data.assetId)
    if (!this.transport.capabilities.media || (asset && !this.transport.capabilities.mediaTypes.includes(asset.type))) {
      if (data.required) throw new Error(`UNSUPPORTED_PLATFORM_CAPABILITY:${this.transport.platform}:media:${node.id}`)
      await this.event(session, 'media_missing', { assetId: data.assetId, optional: true, platform: this.transport.platform }, `media_unsupported:${node.id}:${session.revision}`)
      return
    }
    if (!data.assetId) {
      if (data.required) await this.sendText(user.externalUserId, '[Здесь должен быть обязательный файл: материал не выбран]')
      return
    }
    await this.sendAsset(user, session, version, data.assetId, this.render(version.document, session, data.caption), data.required)
  }

  private async sendAsset(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, assetId: string, caption = '', requiredOverride?: boolean) {
    const asset = version.document.assets.find((item) => item.id === assetId)
    if (!asset) return
    const binding = await this.store.getMediaBinding(version.id, assetId, this.transport.platform)
    if (binding) {
      const captionChars = Array.from(caption)
      await this.transport.sendMedia(user.externalUserId, asset.type, binding, captionChars.slice(0, 1024).join(''))
      if (captionChars.length > 1024) await this.sendText(user.externalUserId, captionChars.slice(1024).join(''))
      await this.event(session, 'media_sent', { assetId, type: asset.type }, `media:${assetId}:${session.revision}`)
      return
    }
    const required = requiredOverride ?? asset.required
    if (!required) {
      await this.event(session, 'media_missing', { assetId, optional: true }, `media_missing:${assetId}:${session.revision}`)
      return
    }
    const placeholder = `[Здесь должен быть файл: «${asset.name}», тип: ${asset.type}]`
    if (version.allowPlaceholders) await this.sendText(user.externalUserId, placeholder)
    await this.event(session, 'media_missing', { assetId, key: asset.key, required: true }, `media_missing:${assetId}:${session.revision}`)
    const notified = session.state.missingMediaNotified ?? []
    if (!notified.includes(assetId)) {
      await this.transport.notifyAdministrators(`Отсутствует файл ${asset.id}/${asset.key} для ${version.document.funnel.key} v${version.document.funnel.version}.`)
      session.state.missingMediaNotified = [...notified, assetId]
    }
    if (!version.allowPlaceholders) throw new Error(`REQUIRED_MEDIA_MISSING:${assetId}`)
  }

  private async scheduleTimer(session: RuntimeSession, document: FunnelDocument, node: FunnelNode) {
    const data = node.data as TimerData
    const rawDue = new Date(this.now().getTime() + timerDelayMs(data))
    const adjusted = applyQuietHours(rawDue, document, data.respectQuietHours)
    if (!adjusted.date) {
      await this.event(session, 'reminder_skipped', { reason: 'quiet_hours', nodeId: node.id }, `timer_skip:${node.id}:${session.revision}`)
      await this.store.scheduleJob({
        uniqueKey: `timer:${session.id}:${node.id}:${session.revision}`,
        type: 'timer_continue',
        payload: { sessionId: session.id, nodeId: node.id, targetNodeId: outgoingNodeId(document, node.id, 'next') },
        dueAt: rawDue.toISOString(),
        maxAttempts: 5,
      })
      return
    }
    await this.store.scheduleJob({
      uniqueKey: `timer:${session.id}:${node.id}:${session.revision}`,
      type: 'timer_continue',
      payload: { sessionId: session.id, nodeId: node.id, targetNodeId: outgoingNodeId(document, node.id, 'next') },
      dueAt: adjusted.date.toISOString(),
      maxAttempts: 5,
    })
    await this.event(session, 'reminder_scheduled', { kind: 'timer', dueAt: adjusted.date.toISOString(), disposition: adjusted.disposition }, `timer:${node.id}:${session.revision}`)
  }

  private async beginOrContinueTest(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, node: FunnelNode) {
    const testId = String((node.data as { testId?: string }).testId ?? '')
    const test = version.document.tests.find((item) => item.id === testId)
    if (!test) throw new Error(`TEST_NOT_FOUND:${testId}`)
    if (!session.state.testRun || session.state.testRun.nodeId !== node.id) {
      const enabled = test.questions.filter((question) => question.enabled)
      const ordered = test.shuffleQuestions ? stableShuffle(enabled, `${session.id}:${test.id}:questions`) : enabled
      const answerOrder = Object.fromEntries(ordered.map((question) => [
        question.id,
        (question.shuffleAnswers ? stableShuffle(question.answers, `${session.id}:${test.id}:${question.id}`) : question.answers).map((answer) => answer.id),
      ]))
      session.state.testRun = {
        testId: test.id,
        nodeId: node.id,
        questionOrder: ordered.map((question) => question.id),
        answerOrder,
        index: 0,
        answers: {},
        selected: [],
      }
      session.status = 'waiting'
      session.state.awaiting = 'callback'
      await this.event(session, 'test_started', { testId }, `test_start:${node.id}:${session.revision}`)
      const welcome = String((node.data as { welcomeText?: string }).welcomeText ?? '')
      if (welcome) await this.sendText(user.externalUserId, this.render(version.document, session, welcome))
    }
    await this.askTestQuestion(user, session, version)
  }

  private async continueTest(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord) {
    const run = session.state.testRun
    if (!run) return
    if (run.index < run.questionOrder.length) {
      await this.askTestQuestion(user, session, version)
      return
    }
    const test = version.document.tests.find((item) => item.id === run.testId)
    if (!test) throw new Error('TEST_NOT_FOUND')
    const calculated = calculateTestResult(test, run.answers)
    const result = calculated.combined ?? calculated.primary
    session.state.lastResultId = result.id
    session.state.lastResultName = result.name
    session.state.lastTestId = test.id
    await this.event(session, 'test_completed', {
      testId: test.id,
      scores: calculated.scores,
      maximums: calculated.maximums,
      percentages: calculated.percentages,
      primaryResultId: calculated.primary.id,
      secondaryResultId: calculated.secondary?.id,
      chosenResultId: result.id,
    }, `test_complete:${run.nodeId}:${session.revision}`)
    await this.sendText(user.externalUserId, this.render(version.document, session, [result.shortText, result.fullText, result.recommendations].filter(Boolean).join('\n\n')))
    if (result.assetId) await this.sendAsset(user, session, version, result.assetId)
    const rows = await this.resultButtons(user, session, version.document, result.buttons, run.nodeId, result.id)
    if (!branchButtons(result.buttons).length) {
      rows.push([{ text: 'Продолжить', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId: run.nodeId, handle: result.id }) }])
    }
    if (rows.length) await this.transport.sendText(user.externalUserId, 'Что сделать дальше?', rows)
    await this.event(session, 'result_viewed', { resultId: result.id, name: result.name }, `result:${result.id}:${session.revision}`)
    session.state.testRun = undefined
    session.state.awaiting = 'callback'
    session.status = 'waiting'
    await this.scheduleReminder(session, version.document, 'test')
    await this.save(session)
  }

  private async askTestQuestion(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord) {
    const run = session.state.testRun
    const question = this.currentQuestion(version.document, run)
    if (!run || !question) {
      await this.continueTest(user, session, version)
      return
    }
    const test = version.document.tests.find((item) => item.id === run.testId)!
    const rows: OutgoingButton[][] = []
    const answerIds = run.answerOrder[question.id] ?? question.answers.map((answer) => answer.id)
    if (question.type === 'single' || (question.type === 'scale' && question.answers.length)) {
      for (const answerId of answerIds) {
        const answer = question.answers.find((item) => item.id === answerId)
        if (answer) rows.push([{ text: this.render(version.document, session, answer.text), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'test_single', nodeId: run.nodeId, testId: test.id, questionId: question.id, answerId }) }])
      }
    } else if (question.type === 'multiple') {
      for (const answerId of answerIds) {
        const answer = question.answers.find((item) => item.id === answerId)
        if (answer) rows.push([{ text: `${run.selected.includes(answerId) ? '✅' : '▫️'} ${this.render(version.document, session, answer.text)}`, callbackToken: await this.store.createCallback(user.id, session.id, { type: 'test_toggle', nodeId: run.nodeId, testId: test.id, questionId: question.id, answerId }) }])
      }
      rows.push([{ text: 'Готово', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'test_submit', nodeId: run.nodeId, testId: test.id, questionId: question.id }) }])
    } else if (question.type === 'scale') {
      const min = Math.trunc(question.scaleMin ?? 1)
      const max = Math.trunc(question.scaleMax ?? 10)
      const values = Array.from({ length: Math.min(20, Math.max(1, max - min + 1)) }, (_, index) => min + index)
      for (let index = 0; index < values.length; index += 5) {
        rows.push(await Promise.all(values.slice(index, index + 5).map(async (value) => ({
          text: String(value),
          callbackToken: await this.store.createCallback(user.id, session.id, { type: 'test_value', nodeId: run.nodeId, testId: test.id, questionId: question.id, value }),
        }))))
      }
    }
    if (!question.required) rows.push([{ text: 'Пропустить', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'test_skip', nodeId: run.nodeId, testId: test.id, questionId: question.id }) }])
    const counter = `${run.index + 1}/${run.questionOrder.length}`
    await this.transport.sendText(user.externalUserId, `${counter}. ${this.render(version.document, session, question.text)}`, rows)
    await this.event(session, 'question_viewed', { testId: test.id, questionId: question.id }, `question_view:${question.id}:${run.index}`)
    session.state.awaiting = ['number', 'text'].includes(question.type) ? 'text' : 'callback'
    session.status = 'waiting'
    await this.scheduleReminder(session, version.document, 'test')
    await this.save(session)
  }

  private async applyTestAnswer(
    session: RuntimeSession,
    document: FunnelDocument,
    action: Extract<CallbackAction, { type: 'test_single' | 'test_value' | 'test_skip' }>,
    multipleValue?: string[],
  ) {
    const run = session.state.testRun
    const question = this.currentQuestion(document, run)
    if (!run || !question || question.id !== action.questionId || run.testId !== action.testId) return session
    let value: string | string[] | number
    if (multipleValue) value = [...multipleValue]
    else if (action.type === 'test_value') value = action.value
    else if (action.type === 'test_skip') value = ''
    else value = action.answerId
    run.answers[question.id] = value
    run.index += 1
    run.selected = []
    session.status = 'active'
    session.state.awaiting = undefined
    await this.store.saveAnswer(session.id, run.testId, question.id, value)
    await this.event(session, 'question_answered', { testId: run.testId, questionId: question.id, skipped: action.type === 'test_skip' }, `question_answer:${question.id}`)
    const saved = await this.save(session)
    await this.scheduleRecovery(saved)
    return saved
  }

  private async handleTestText(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, text: string) {
    const run = session.state.testRun
    const question = this.currentQuestion(version.document, run)
    if (!run || !question || !['number', 'text'].includes(question.type)) return false
    const trimmed = text.trim()
    if (!trimmed && question.required) {
      await this.transport.sendText(user.externalUserId, 'Ответ не может быть пустым.')
      return false
    }
    let value: string | number = trimmed
    if (question.type === 'number') {
      const normalized = Number(trimmed.replace(',', '.'))
      if (!Number.isFinite(normalized)) {
        await this.transport.sendText(user.externalUserId, 'Введите число, например 7 или 7,5.')
        return false
      }
      value = normalized
    }
    run.answers[question.id] = value
    run.index += 1
    session.status = 'active'
    session.state.awaiting = undefined
    await this.store.saveAnswer(session.id, run.testId, question.id, value)
    await this.event(session, 'question_answered', { testId: run.testId, questionId: question.id }, `question_answer:${question.id}`)
    const saved = await this.save(session)
    await this.scheduleRecovery(saved)
    await this.continueTest(user, saved, version)
    return true
  }

  private async beginOrContinueForm(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, node: FunnelNode) {
    const data = node.data as FormData
    if (!session.state.formRun || session.state.formRun.nodeId !== node.id) {
      session.state.formRun = { nodeId: node.id, index: 0, values: {} }
      await this.event(session, 'form_started', {}, `form_start:${node.id}:${session.revision}`)
      if (data.introText) await this.sendText(user.externalUserId, this.render(version.document, session, data.introText))
    }
    await this.promptFormField(user, session, version, node)
  }

  private async promptFormField(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, node: FunnelNode): Promise<void> {
    const data = node.data as FormData
    const run = session.state.formRun
    if (!run) return
    const field = data.fields[run.index]
    if (!field) {
      const values = structuredClone(run.values)
      session.state.formRun = undefined
      const nextId = outgoingNodeId(version.document, node.id, 'submitted')
      const nextNode = version.document.nodes.find((item) => item.id === nextId)
      if (nextNode?.type === 'consent') session.state.pendingFormSubmission = { values }
      else await this.persistApplication(user, session, values)
      await this.sendText(user.externalUserId, this.render(version.document, session, data.confirmationText))
      await this.event(session, 'form_submitted', { fieldCount: Object.keys(values).length }, `form_submit:${node.id}:${session.revision}`)
      const advanced = await this.advanceAndSave(session, version.document, node.id, 'submitted')
      await this.run(user, advanced)
      return
    }
    if (field.type === 'username' && user.username && !run.values[field.id]) {
      run.values[field.id] = `@${user.username.replace(/^@/, '')}`
      run.index += 1
      return this.promptFormField(user, session, version, node)
    }
    const cancel = await this.store.createCallback(user.id, session.id, { type: 'form_cancel', nodeId: node.id })
    await this.transport.sendText(user.externalUserId, `${this.render(version.document, session, field.label)}${field.required ? ' *' : ''}`, [[{ text: 'Отменить', callbackToken: cancel }]])
    session.status = 'waiting'
    session.state.awaiting = 'text'
    await this.scheduleReminder(session, version.document, 'stage')
    await this.save(session)
  }

  private async handleFormText(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, text: string) {
    const node = this.requireCurrentNode(version.document, session)
    if (node.type !== 'form') return false
    const data = node.data as FormData
    const run = session.state.formRun
    const field = run ? data.fields[run.index] : undefined
    if (!run || !field) return false
    const value = text.trim()
    if (!value && field.required) {
      await this.transport.sendText(user.externalUserId, 'Это поле обязательно.')
      return false
    }
    if (field.type === 'email' && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      await this.transport.sendText(user.externalUserId, 'Проверьте email: нужен адрес вида name@example.com.')
      return false
    }
    if (field.type === 'phone' && value && value.replace(/\D/g, '').length < 7) {
      await this.transport.sendText(user.externalUserId, 'Проверьте номер телефона.')
      return false
    }
    run.values[field.id] = value
    run.index += 1
    session.status = 'active'
    session.state.awaiting = undefined
    const saved = await this.save(session)
    await this.scheduleRecovery(saved)
    await this.promptFormField(user, saved, version, node)
    return true
  }

  private async persistApplication(user: RuntimeUser, session: RuntimeSession, values: Record<string, string>) {
    const created = await this.store.saveContactAndApplication(session, values)
    await this.transport.notifyAdministrators([
      'Новая заявка',
      `${user.platform.toUpperCase()} ID: ${user.externalUserId}`,
      ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    ].join('\n'))
    await this.event(session, 'application_created', created, `application:${created.applicationId}`)
  }

  private async sendConsent(user: RuntimeUser, session: RuntimeSession, document: FunnelDocument, node: FunnelNode) {
    const data = node.data as ConsentData
    const rows: OutgoingButton[][] = []
    if (data.policyUrl) rows.push([{ text: 'Политика обработки данных', url: data.policyUrl }])
    rows.push([{ text: this.render(document, session, data.acceptText), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'consent', nodeId: node.id, accepted: true }) }])
    if (data.declineEnabled) rows.push([{ text: this.render(document, session, data.declineText), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'consent', nodeId: node.id, accepted: false }) }])
    await this.sendText(user.externalUserId, this.render(document, session, data.text), rows)
  }

  private async sendProductNode(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, node: FunnelNode) {
    const data = node.data as ProductBlockData
    const product = version.document.products.find((item) => item.id === data.productId)
    if (!product || !product.active) {
      await this.sendText(user.externalUserId, 'Предложение сейчас недоступно.')
      const handle = data.allowSkip ? 'skip' : 'failed'
      const token = await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId: node.id, handle })
      await this.transport.sendText(user.externalUserId, 'Продолжить', [[{ text: 'Продолжить', callbackToken: token }]])
      session.status = 'waiting'
      session.state.awaiting = 'callback'
      await this.save(session)
      return
    }
    const alreadyPurchased = await this.store.hasPurchase(user.id, version.id, product.id)
    const config = alreadyPurchased ? await this.store.getProductConfig(version.id, product.id) : null
    const repeatPolicy = config?.repeatPolicy ?? 'redeliver'
    if (alreadyPurchased && repeatPolicy !== 'repurchase') {
      if (repeatPolicy === 'redeliver') {
        await this.sendText(user.externalUserId, 'Вы уже покупали этот материал. Отправляю его повторно.')
        if (config) await this.deliverConfiguredAssets(user, session, version, config, null, false)
      } else {
        await this.sendText(user.externalUserId, 'Вы уже покупали этот материал. Повторная покупка отключена.')
      }
      const advanced = await this.advanceAndSave(session, version.document, node.id, 'already_purchased')
      await this.run(user, advanced)
      return
    }
    await this.event(session, 'product_viewed', { productId: product.id }, `product_view:${node.id}:${session.revision}`)
    const rows: OutgoingButton[][] = [[{
      text: this.render(version.document, session, data.payButtonText || `Купить — ${product.price}`),
      callbackToken: await this.store.createCallback(user.id, session.id, { type: 'product_buy', nodeId: node.id, productId: product.id }),
    }]]
    if (data.allowSkip) rows.push([{ text: 'Продолжить без покупки', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'product_skip', nodeId: node.id }) }])
    await this.sendText(user.externalUserId, this.render(version.document, session, [data.headline, data.description].filter(Boolean).join('\n\n')), rows)
    session.status = 'waiting'
    session.state.awaiting = 'payment'
    await this.save(session)
  }

  private async beginProductPurchase(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, productId: string) {
    const product = version.document.products.find((item) => item.id === productId)
    const config = await this.store.getProductConfig(version.id, productId)
    if (!product || !product.active || !config || config.provider === 'unconfigured') {
      await this.transport.sendText(user.externalUserId, 'Оплата этого продукта ещё не настроена администратором.')
      return
    }
    let provider
    try {
      provider = paymentProviderFor(config, this.options.paymentProviderToken)
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error)
      const text = code === 'DIGITAL_REQUIRES_STARS'
        ? 'Для цифрового товара внутри Telegram требуется оплата Telegram Stars.'
        : code === 'TELEGRAM_PAYMENT_PROVIDER_TOKEN_REQUIRED'
          ? 'Платёжный provider token ещё не настроен.'
          : 'Настройки оплаты некорректны.'
      await this.transport.sendText(user.externalUserId, text)
      return
    }
    const alreadyPurchased = await this.store.hasPurchase(user.id, version.id, productId)
    if (alreadyPurchased && config.repeatPolicy !== 'repurchase') {
      if (config.repeatPolicy === 'redeliver') {
        await this.deliverConfiguredAssets(user, session, version, config, null, false)
      }
      const node = this.requireCurrentNode(version.document, session)
      const advanced = await this.advanceAndSave(session, version.document, node.id, 'already_purchased')
      await this.run(user, advanced)
      return
    }
    const payment = await this.store.createPayment({
      idempotencyKey: alreadyPurchased
        ? `${session.id}:${session.currentNodeId}:${productId}:${randomBytes(8).toString('base64url')}`
        : `${session.id}:${session.currentNodeId}:${productId}`,
      userId: user.id,
      sessionId: session.id,
      versionId: version.id,
      funnelId: session.funnelId,
      productId,
      provider: config.provider,
      invoicePayload: config.provider === 'mock' ? `mock:${randomBytes(10).toString('base64url')}` : `pay_${randomBytes(16).toString('base64url')}`,
      amountMinor: config.amountMinor,
      currency: provider.currency(config),
    })
    await this.event(session, 'payment_started', { productId, provider: config.provider, amountMinor: payment.amountMinor, currency: payment.currency }, `payment_start:${payment.id}`)
    if (payment.status === 'paid') {
      await this.finishPayment(user, payment, `recovery_${payment.id}`)
      return
    }
    if (provider.settlesImmediately) {
      await this.finishPayment(user, payment, `mock_${payment.id}`)
      return
    }
    await this.transport.sendInvoice(user.externalUserId, {
      title: product.name.slice(0, 32),
      description: product.description.slice(0, 255) || product.name,
      payload: payment.invoicePayload,
      provider: config.provider,
      providerToken: provider.providerToken(this.options.paymentProviderToken),
      currency: payment.currency,
      amountMinor: payment.amountMinor,
    })
    session.state.awaiting = 'payment'
    session.status = 'waiting'
    await this.save(session)
  }

  private async finishPayment(user: RuntimeUser, payment: PaymentRecord, telegramChargeId: string, providerChargeId?: string) {
    const paid = await this.store.markPaymentPaid(payment.id, telegramChargeId, providerChargeId)
    const version = await this.requireVersion(payment.versionId)
    const session = await this.store.getSession(payment.sessionId)
    if (!session) return
    const config = await this.store.getProductConfig(version.id, payment.productId)
    if (!config) return
    const purchase = await this.store.recordPurchase(paid.payment)
    if (paid.firstSuccess) {
      await this.sendText(user.externalUserId, this.render(version.document, session, config.afterPurchaseText || version.document.products.find((item) => item.id === payment.productId)?.afterPurchaseText || 'Спасибо за покупку!'))
      await this.event(session, 'payment_succeeded', { paymentId: payment.id, productId: payment.productId, amountMinor: payment.amountMinor, currency: payment.currency }, `payment_success:${payment.id}`)
    }
    if (purchase.created || config.repeatPolicy !== 'repurchase') {
      await this.deliverConfiguredAssets(user, session, version, config, purchase.purchaseId, true)
    } else if (paid.firstSuccess) {
      await this.deliverConfiguredAssets(user, session, version, config, null, false)
    }
    const node = session.currentNodeId ? version.document.nodes.find((item) => item.id === session.currentNodeId) : undefined
    if (node?.type === 'product' && (node.data as ProductBlockData).productId === payment.productId) {
      const advanced = await this.advanceAndSave(session, version.document, node.id, 'paid')
      await this.run(user, advanced)
    }
  }

  private async deliverConfiguredAssets(user: RuntimeUser, session: RuntimeSession, version: FunnelVersionRecord, config: ProductRuntimeConfig, purchaseId: string | null, enforceOnce: boolean) {
    const personalized = session.state.lastResultId ? config.deliveryByResult[session.state.lastResultId] ?? [] : []
    const assetIds = [...new Set([...config.deliveryAssetIds, ...personalized])]
    for (const assetId of assetIds) {
      const deliveryKey = `${purchaseId ?? 'redelivery'}:${assetId}`
      if (enforceOnce && purchaseId && await this.store.isDelivered(purchaseId, assetId)) continue
      await this.sendAsset(user, session, version, assetId)
      if (enforceOnce && purchaseId) await this.store.markDelivered(purchaseId, assetId, deliveryKey)
      await this.event(session, 'content_delivered', { productId: config.productId, assetId }, `delivery:${deliveryKey}`)
    }
  }

  private async sendExternalLink(user: RuntimeUser, session: RuntimeSession, document: FunnelDocument, node: FunnelNode) {
    const data = node.data as ExternalLinkData
    const url = await this.safeActionUrl(user, session, data.url, Boolean(data.continueAfterClick))
    const rows: OutgoingButton[][] = [[{ text: this.render(document, session, data.buttonText), url }]]
    if (!this.options.publicBaseUrl || !data.continueAfterClick) {
      rows.push([{ text: 'Продолжить', callbackToken: await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId: node.id, handle: 'next' }) }])
      const suffix = !this.options.publicBaseUrl
        ? '\n\nЛокальный режим: Telegram не сообщает о клике по ссылке, поэтому после просмотра нажмите «Продолжить».'
        : '\n\nПосле просмотра нажмите «Продолжить».'
      await this.sendText(user.externalUserId, `${this.render(document, session, data.text)}${suffix}`, rows)
      return
    }
    await this.sendText(user.externalUserId, this.render(document, session, data.text), rows)
  }

  private async safeActionUrl(user: RuntimeUser, session: RuntimeSession, target: string, continueAfterClick: boolean) {
    const parsed = new URL(target)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('UNSAFE_URL')
    if (!this.options.publicBaseUrl) return parsed.toString()
    const token = await this.store.createRedirect(user.id, session.id, parsed.toString(), continueAfterClick)
    return `${this.options.publicBaseUrl}/r/${token}`
  }

  private async resultButtons(user: RuntimeUser, session: RuntimeSession, document: FunnelDocument, buttons: ResultButton[], nodeId: string, resultHandle: string) {
    const rows: OutgoingButton[][] = []
    for (const button of buttons) {
      if (button.action === 'branch') {
        rows.push([{ text: this.render(document, session, button.text), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'advance', nodeId, handle: resultHandle }) }])
      } else if (button.action === 'url' && button.url) {
        rows.push([{ text: this.render(document, session, button.text), url: await this.safeActionUrl(user, session, button.url, false) }])
      } else if (button.action === 'product' && button.productId) {
        rows.push([{ text: this.render(document, session, button.text), callbackToken: await this.store.createCallback(user.id, session.id, { type: 'product_buy', nodeId, productId: button.productId }) }])
      }
    }
    return rows
  }

  private currentQuestion(document: FunnelDocument, run: RuntimeSession['state']['testRun']): TestQuestion | undefined {
    if (!run) return undefined
    const test = document.tests.find((item) => item.id === run.testId)
    return test?.questions.find((question) => question.id === run.questionOrder[run.index])
  }

  private async scheduleReminder(session: RuntimeSession, document: FunnelDocument, kind: 'test' | 'stage') {
    const maximum = Math.min(kind === 'test' ? 2 : 1, document.bot.reminders.maxCount)
    if (maximum <= 0) return
    const delay = kind === 'test' ? 2 * 3_600_000 : 24 * 3_600_000
    const adjusted = applyQuietHours(new Date(this.now().getTime() + delay), document, document.bot.reminders.respectQuietHours)
    if (!adjusted.date) {
      await this.event(session, 'reminder_skipped', { reason: 'quiet_hours', kind }, `reminder_skip:${session.currentNodeId}:${session.revision}`)
      return
    }
    await this.store.scheduleJob({
      uniqueKey: `reminder:${session.id}:${session.currentNodeId}:${session.revision}:1`,
      type: 'reminder',
      payload: {
        sessionId: session.id,
        nodeId: session.currentNodeId,
        count: 1,
        maximum,
        text: kind === 'test' ? 'Продолжим тест? Ваши ответы сохранены.' : 'Продолжим? Вы остановились на важном этапе.',
      },
      dueAt: adjusted.date.toISOString(),
      maxAttempts: 5,
    })
    await this.event(session, 'reminder_scheduled', { kind, dueAt: adjusted.date.toISOString(), maximum }, `reminder_schedule:${session.currentNodeId}:${session.revision}`)
  }

  private async advanceAndSave(session: RuntimeSession, document: FunnelDocument, sourceId: string, handle: string) {
    const next = await this.advanceInMemory(session, document, sourceId, handle)
    const saved = await this.save(next)
    await this.scheduleRecovery(saved)
    return saved
  }

  private async advanceInMemory(session: RuntimeSession, document: FunnelDocument, sourceId: string, handle: string) {
    const target = outgoingNodeId(document, sourceId, handle)
    if (!target) throw new Error(`MISSING_TRANSITION:${sourceId}:${handle}`)
    await this.event(session, 'node_completed', { handle }, `node_complete:${sourceId}:${session.revision}`)
    if (handle !== 'next') await this.event(session, 'branch_selected', { handle }, `branch:${sourceId}:${handle}:${session.revision}`)
    session.currentNodeId = target
    session.status = 'active'
    session.state.awaiting = undefined
    session.state.lastNodeEntered = undefined
    return session
  }

  private async enterNode(session: RuntimeSession, node: FunnelNode) {
    if (session.state.lastNodeEntered === node.id) return
    session.state.lastNodeEntered = node.id
    await this.event(session, 'node_entered', { nodeType: node.type }, `node_enter:${node.id}:${session.revision}`)
  }

  private async save(session: RuntimeSession) {
    return this.store.saveSession(session, session.revision)
  }

  private async scheduleRecovery(session: RuntimeSession) {
    if (session.status !== 'active' || !session.currentNodeId) return
    await this.store.scheduleJob({
      uniqueKey: `resume:${session.id}:${session.revision}`,
      type: 'resume_session',
      payload: { sessionId: session.id, nodeId: session.currentNodeId },
      dueAt: new Date(this.now().getTime() + this.recoveryDelayMs).toISOString(),
      maxAttempts: 5,
    })
  }

  private async sendText(recipientId: string, text: string, buttons?: OutgoingButton[][]) {
    const parts = splitTelegramText(text)
    if (!parts.length && buttons?.length) {
      await this.transport.sendText(recipientId, 'Продолжить', buttons)
      return
    }
    for (let index = 0; index < parts.length; index += 1) {
      await this.transport.sendText(recipientId, parts[index]!, index === parts.length - 1 ? buttons : undefined)
    }
  }

  private render(document: FunnelDocument, session: RuntimeSession, text: string) {
    return renderVariableTemplate(text, document.variables, session.state.variables ?? initialVariableValues(document.variables))
  }

  private requireCurrentNode(document: FunnelDocument, session: RuntimeSession) {
    const node = document.nodes.find((item) => item.id === session.currentNodeId)
    if (!node) throw new Error(`NODE_NOT_FOUND:${session.currentNodeId}`)
    return node
  }

  private async requireVersion(versionId: string) {
    const version = await this.store.getVersion(versionId)
    if (!version) throw new Error(`VERSION_NOT_FOUND:${versionId}`)
    return version
  }

  private assertProfilePlatform(profile: PlatformProfile) {
    if (profile.platform !== this.transport.platform) {
      throw new Error(`PLATFORM_TRANSPORT_MISMATCH:${profile.platform}:${this.transport.platform}`)
    }
  }

  private async event(session: RuntimeSession, type: string, payload: Record<string, unknown>, suffix: string) {
    await this.store.appendEvent({
      idempotencyKey: `${session.id}:${type}:${suffix}`,
      type,
      userId: session.userId,
      sessionId: session.id,
      funnelId: session.funnelId,
      versionId: session.versionId,
      nodeId: session.currentNodeId ?? undefined,
      trackingId: session.sourceTrackingId,
      payload: { platform: session.state.platform, ...payload },
      occurredAt: this.now().toISOString(),
    })
  }
}

function normalizeTelegramCommand(value: string | undefined): string | null {
  const token = value?.trim().split(/\s+/, 1)[0]?.split('@', 1)[0]?.toLowerCase()
  if (!token) return null
  const command = token.startsWith('/') ? token : `/${token}`
  return /^\/[a-z0-9_]+$/.test(command) ? command : null
}
