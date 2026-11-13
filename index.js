/**
 * 大肥鱼语聊 —— Host half.
 *
 * Forwards three browser calls to the DeepSeek API with the profile's stored
 * `DEEPSEEK_API_KEY`:
 *
 * - `POST /dafeiyu/tts`    text  -> `audio/wav` (voice `stella` | `tide`)
 * - `POST /dafeiyu/asr`    16-bit PCM WAV body -> `{ text }`
 * - `POST /dafeiyu/chat`   conversation -> SSE deltas of the answer
 *
 * The key never reaches the page: the browser only talks to this Host, and the
 * Host resolves the credential per request through the credentials service.
 */

/** DeepSeek public API origin. */
const API_BASE = 'https://api.deepseek.com'

/** Credential reference the Models page writes and the LLM providers read. */
const CREDENTIAL = 'DEEPSEEK_API_KEY'

/** Chat model: the Flash model carries vision, which the image button needs. */
const MODEL = 'deepseek-flash'

/** Voice ids published by the TTS guide. */
const VOICES = Object.freeze(['stella', 'tide'])

const MAX_TTS_CHARS = 3000
const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_JSON_BYTES = 64 * 1024 * 1024
const MAX_MESSAGES = 40
const REQUEST_TIMEOUT_MS = 180_000

const SYSTEM_PROMPT = [
  '你是「大肥鱼」，一条住在 DeepSeek 世界里的圆滚滚小鱼，正在用语音和用户聊天。',
  '规则：',
  '1. 用口语说话，亲切、简短：通常 1~3 句，不超过 120 个汉字。',
  '2. 只输出可以直接朗读的句子，不要 Markdown、列表、代码块、表情符号或链接。',
  '3. 用户发来图片时，先用一两句话说出你看到的内容，再回答他的问题。',
  '4. 没有听清或没有听懂时，礼貌地请对方再说一次。',
].join('\n')

/** One failure with an HTTP status the client can show verbatim. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Reject a non-2xx exchange after the body is drained, so the socket can be reused. */
function fail(status, code, message) {
  return new HttpError(status, code, message)
}

/** Write one JSON reply with no-store caching. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Read the whole request body, refusing anything past `limit` bytes. */
async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw fail(413, 'too-large', '请求内容太大了，请换一张更小的图片。')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Read and parse a JSON body. */
async function readJson(req, limit) {
  const raw = await readBody(req, limit)
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw.toString('utf8'))
    if (parsed !== null && typeof parsed === 'object') return parsed
    throw new Error('not an object')
  } catch (error) {
    throw fail(400, 'bad-json', '请求格式不正确。')
  }
}

/** The stored DeepSeek key (and where it came from), or undefined when absent. */
async function resolveKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(CREDENTIAL)
    if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) {
      return { value: hit.value, source: typeof hit.source === 'string' ? hit.source : 'credentials' }
    }
  }
  const ambient = process.env[CREDENTIAL]
  if (typeof ambient === 'string' && ambient.length > 0) return { value: ambient, source: 'env' }
  return undefined
}

/** Short, non-reversible fingerprint of a key for display. */
function maskKey(value) {
  return value.length <= 10 ? '••••••••' : `${value.slice(0, 3)}…${value.slice(-4)}`
}

/** The stored API key, or a message naming the missing credential. */
async function apiKey(ctx) {
  const hit = await resolveKey(ctx)
  if (hit !== undefined) return hit.value
  throw fail(
    503,
    'missing-credential',
    '还没有可用的 DeepSeek API Key。语音识别、语音合成和看图都用它，和 Harness 里选的聊天模型无关。',
  )
}

/** Short, human-readable detail from one upstream failure body. */
async function upstreamDetail(response) {
  try {
    const text = await response.text()
    if (text.length === 0) return ''
    try {
      const parsed = JSON.parse(text)
      const message = parsed?.error?.message ?? parsed?.message
      if (typeof message === 'string' && message.length > 0) return message.slice(0, 300)
    } catch {
      /* not JSON: keep the raw text */
    }
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

/** Translate one DeepSeek API failure into the message the panel shows. */
async function upstreamFailure(response, what) {
  const detail = await upstreamDetail(response)
  const suffix = detail.length > 0 ? `（${detail}）` : ''
  if (response.status === 401 || response.status === 403) {
    return fail(502, 'unauthorized', `DeepSeek API Key 无效或已过期，请重新保存${suffix}`)
  }
  if (response.status === 429) return fail(429, 'rate-limited', `请求太频繁了，稍等一会儿再试${suffix}`)
  if (response.status === 400) return fail(400, 'rejected', `${what}被拒绝了${suffix}`)
  if (response.status === 503 || response.status === 504) {
    return fail(503, 'busy', `DeepSeek ${what}服务繁忙，请稍后重试${suffix}`)
  }
  return fail(502, 'upstream', `${what}失败（HTTP ${String(response.status)}）${suffix}`)
}

/** Run one upstream request and map transport failures to `HttpError`. */
async function callUpstream(url, init) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (controller.signal.aborted) throw fail(504, 'timeout', 'DeepSeek 太久没有响应，请重试。')
    throw fail(502, 'network', '连接不上 DeepSeek，请检查网络后重试。')
  } finally {
    clearTimeout(timeout)
  }
}

/** `POST /dafeiyu/tts`: synthesize one sentence and return the WAV bytes. */
async function handleTts(ctx, req, res) {
  const payload = await readJson(req, 256 * 1024)
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (text.length === 0) throw fail(400, 'empty-text', '没有可朗读的文本。')
  const voiceId = VOICES.includes(payload.voice_id) ? payload.voice_id : 'stella'
  const key = await apiKey(ctx)

  const response = await callUpstream(`${API_BASE}/v1/tools/tts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, MAX_TTS_CHARS), voice_id: voiceId, format: 'wav' }),
  })
  if (!response.ok) throw await upstreamFailure(response, '语音合成')
  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.length === 0) throw fail(502, 'empty-audio', '语音合成没有返回音频。')
  res.writeHead(200, {
    'content-type': 'audio/wav',
    'cache-control': 'no-store',
    'content-length': audio.length,
  })
  res.end(audio)
}

/** `POST /dafeiyu/asr`: transcribe one recorded utterance. */
async function handleAsr(ctx, req, res) {
  const audio = await readBody(req, MAX_AUDIO_BYTES)
  if (audio.length < 1024) throw fail(400, 'empty-audio', '没有录到声音，再说一次吧。')
  const key = await apiKey(ctx)
  const form = new FormData()
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav')

  const response = await callUpstream(`${API_BASE}/v1/tools/asr`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  })
  if (!response.ok) throw await upstreamFailure(response, '语音识别')
  let payload
  try {
    payload = await response.json()
  } catch {
    throw fail(502, 'bad-response', '语音识别返回了无法解析的结果。')
  }
  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  sendJson(res, 200, { text })
}

/** Keep one incoming message in the shape the chat endpoint accepts. */
function normalizeMessage(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : undefined
  if (role === undefined) return undefined
  const text = typeof raw.text === 'string' ? raw.text.slice(0, 4000) : ''
  const image = typeof raw.image === 'string' && raw.image.startsWith('data:image/') ? raw.image : undefined
  if (text.length === 0 && image === undefined) return undefined
  return { role, text, image }
}

/** Map one normalized message onto an OpenAI-compatible content value. */
function toApiMessage(message) {
  if (message.image === undefined) return { role: message.role, content: message.text }
  const blocks = []
  if (message.text.length > 0) blocks.push({ type: 'text', text: message.text })
  blocks.push({ type: 'image_url', image_url: { url: message.image } })
  return { role: message.role, content: blocks }
}

/** `POST /dafeiyu/chat`: stream the answer as Server-Sent Events. */
async function handleChat(ctx, req, res) {
  const payload = await readJson(req, MAX_JSON_BYTES)
  const incoming = Array.isArray(payload.messages) ? payload.messages : []
  const messages = incoming.map(normalizeMessage).filter((message) => message !== undefined)
  if (messages.length === 0) throw fail(400, 'empty-messages', '没有可以发送的消息。')
  const key = await apiKey(ctx)

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  let closed = false
  res.on('close', () => {
    closed = true
  })

  const writeEvent = (event) => {
    if (closed || res.writableEnded) return
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      closed = true
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS)
  const onClose = () => controller.abort(new Error('client-closed'))
  res.on('close', onClose)

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.slice(-MAX_MESSAGES).map(toApiMessage),
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const failure = await upstreamFailure(response, '对话')
      writeEvent({ error: { code: failure.code, message: failure.message } })
      return
    }
    if (response.body === null) {
      writeEvent({ error: { code: 'empty-stream', message: '对话没有返回内容，请重试。' } })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reason = 'stop'

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data.length === 0) continue
        if (data === '[DONE]') {
          writeEvent({ done: true, reason })
          return
        }
        let parsed
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        const choice = parsed?.choices?.[0]
        const delta = typeof choice?.delta?.content === 'string' ? choice.delta.content : ''
        if (delta.length > 0) writeEvent({ delta })
        if (typeof choice?.finish_reason === 'string') reason = choice.finish_reason
      }
    }
    writeEvent({ done: true, reason })
  } catch (error) {
    if (controller.signal.aborted && !closed) {
      writeEvent({ error: { code: 'timeout', message: 'DeepSeek 太久没有响应，请重试。' } })
    } else if (error instanceof HttpError) {
      writeEvent({ error: { code: error.code, message: error.message } })
    } else if (!closed) {
      writeEvent({ error: { code: 'network', message: '连接不上 DeepSeek，请检查网络后重试。' } })
    }
  } finally {
    clearTimeout(timeout)
    res.off('close', onClose)
    if (!res.writableEnded) res.end()
  }
}

/**
 * `GET /dafeiyu/status`: the first thing the panel asks for.
 *
 * The conversation model is fixed at `deepseek-flash` and every speech call
 * goes to the DeepSeek platform API, so the only thing worth checking before
 * the user starts talking is the DeepSeek key itself — the Harness model
 * selection (deepseek-flash, a Xiaomi route, anything else) does not take part.
 */
async function handleStatus(ctx, req, res) {
  const hit = await resolveKey(ctx)
  sendJson(res, 200, {
    ready: hit !== undefined,
    source: hit === undefined ? '' : hit.source,
    masked: hit === undefined ? '' : maskKey(hit.value),
    message:
      hit === undefined
        ? '还没有可用的 DeepSeek API Key。语音识别、语音合成和看图都用它，和 Harness 里选的聊天模型无关。'
        : '',
    voices: VOICES,
    model: MODEL,
  })
}

/** `POST /dafeiyu/key`: verify one pasted key and store it as the credential every provider shares. */
async function handleKey(ctx, req, res) {
  const payload = await readJson(req, 8 * 1024)
  const key = typeof payload.key === 'string' ? payload.key.trim() : ''
  if (!/^sk-[A-Za-z0-9_-]{10,}$/u.test(key)) {
    throw fail(400, 'bad-key', 'Key 看起来不完整：DeepSeek 的 Key 形如 sk-xxxxxxxx。')
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw fail(503, 'no-credentials', '当前 profile 没有 credentials 服务，暂时无法保存 Key。')

  const probe = await callUpstream(`${API_BASE}/models`, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}` },
  })
  if (!probe.ok) {
    if (probe.status === 401 || probe.status === 403) {
      throw fail(400, 'invalid-key', 'DeepSeek 不接受这个 Key，请检查是否复制完整、是否已被删除。')
    }
    throw await upstreamFailure(probe, 'Key 校验')
  }
  try {
    await probe.arrayBuffer()
  } catch {
    /* the body is only drained to free the socket */
  }

  await credentials.set(CREDENTIAL, key)
  sendJson(res, 200, { ok: true, masked: maskKey(key) })
}

/** Wrap one handler so a thrown `HttpError` becomes a JSON reply. */
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (res.writableEnded) return
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      sendJson(res, 500, {
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }
}

export const name = 'dafeiyu-voice-chat'
export const inject = ['webServer']

export function apply(ctx, config) {
  const enabled = config?.enabled !== false
  if (!enabled) return
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dafeiyu/tts',
        handler: route((req, res) => handleTts(ctx, req, res)),
      }),
    'dafeiyu: tts route',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dafeiyu/asr',
        handler: route((req, res) => handleAsr(ctx, req, res)),
      }),
    'dafeiyu: asr route',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dafeiyu/chat',
        handler: route((req, res) => handleChat(ctx, req, res)),
      }),
    'dafeiyu: chat route',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dafeiyu/status',
        handler: route((req, res) => handleStatus(ctx, req, res)),
      }),
    'dafeiyu: status route',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dafeiyu/key',
        handler: route((req, res) => handleKey(ctx, req, res)),
      }),
    'dafeiyu: key route',
  )
}
