/**
 * 大肥鱼语聊 —— Client half.
 *
 * Registers one frame-wide entry in `shell.overlay`: a floating launcher that
 * opens a voice-chat panel. The panel speaks through the Host `/dafeiyu/*`
 * routes, records with Web Audio, plays TTS through an AnalyserNode so the
 * orb can follow the actual audio level, and sends a picked image to the
 * vision model.
 */
window.__ModuleLoader__.load({
  id: 'dsh-dafeiyu-voice-chat',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /* ------------------------------------------------------------------ *
     * Constants and small helpers
     * ------------------------------------------------------------------ */

    const NS = 'dafeiyu'
    const STORAGE_VOICE = 'dafeiyu.voice'
    const STORAGE_CONTINUOUS = 'dafeiyu.continuous'
    const CHAT_ENDPOINT = '/dafeiyu/chat'
    const TTS_ENDPOINT = '/dafeiyu/tts'
    const ASR_ENDPOINT = '/dafeiyu/asr'
    const STATUS_ENDPOINT = '/dafeiyu/status'
    const KEY_ENDPOINT = '/dafeiyu/key'
    const CREDENTIAL = 'DEEPSEEK_API_KEY'
    const SILENCE_MS = 1300
    const MAX_RECORD_MS = 45_000

    /** Launcher geometry: the round button the user can move anywhere in the page. */
    const FAB_SIZE = 52
    const FAB_MARGIN = 10
    const FAB_STORAGE = 'dafeiyu.fab'
    const MIC_STORAGE = 'dafeiyu.mic'

    /** The plugin mark: the blue-fish illustration wrapped in an SVG package asset. */
    const MARK_URL = (() => {
      const specifier = 'plugins/dsh-dafeiyu-voice-chat/assets/fish.svg'
      try {
        if (typeof require.asset === 'function') {
          const resolved = require.asset(specifier)
          if (typeof resolved === 'string' && resolved.length > 0) return resolved
        }
      } catch {
        /* the plain package-asset route works without the build-time helper */
      }
      return specifier
    })()

    const VOICES = [
      {
        id: 'stella',
        name: 'Stella',
        alias: '海星',
        gender: '女声',
        blurb: '温柔清亮',
        gradient: 'linear-gradient(145deg, #ffd0dd 0%, #f382b0 46%, #b34d8e 100%)',
      },
      {
        id: 'tide',
        name: 'Tide',
        alias: '暗潮',
        gender: '男声',
        blurb: '低沉沉稳',
        gradient: 'linear-gradient(145deg, #cfe0ff 0%, #6f9bf5 46%, #3853b8 100%)',
      },
    ]

    const DICT = {
      zh: {
        launcher: '打开大肥鱼语聊',
        title: '大肥鱼语聊',
        subtitle: 'DeepSeek 语音对话',
        pickTitle: '选择一种语音',
        pickSub: '大肥鱼会用这个声音和你聊天',
        preview: '试听',
        previewText: '你好呀，我是大肥鱼。',
        start: '开始聊天',
        cancel: '取消',
        settings: '设置',
        close: '关闭',
        voice: '语音',
        continuous: '连续对话',
        continuousHint: '回答完自动继续听',
        clear: '清空对话',
        reselect: '重新选择语音',
        listen: '点击麦克风，说给我听',
        listening: '我在听…',
        thinking: '想一想…',
        speaking: '正在说…',
        idle: '点击麦克风开始',
        image: '发图片',
        attachHint: '可以问问这张图…',
        send: '发送',
        micOn: '开始说话',
        micOff: '停下来',
        emptyAnswer: '这一次没有收到回答，再说一次吧。',
        asrEmpty: '没有听清，再说一次好吗？',
        imageType: '只能发送图片哦。',
        imageTooBig: '这张图片太大了，换一张吧。',
        needMic: '浏览器没有麦克风权限，请在地址栏里允许麦克风。',
        noMic: '没有找到可用的麦克风。',
        imagePrompt: '看看这张图',
        typeHint: '输入文字，或点击麦克风说话',
        micSource: '麦克风',
        micDefault: '系统默认麦克风',
        micFallback: '麦克风',
        micRefresh: '重新检测',
        micUnknown: '之前选的麦克风（已断开）',
        micMissing: '找不到之前选的麦克风，已改用系统默认。',
        micNeedPermission: '第一次录音后才能看到设备名字',
        gateChecking: '正在检查 DeepSeek Key…',
        keyTitle: '先填一个 DeepSeek API Key',
        keyWhy: '语音识别、语音合成和看图都走 DeepSeek 平台接口，靠的是 DeepSeek 的 Key——和你在 Harness 里选的聊天模型无关。',
        keyWhy2: '所以就算 Harness 里选的是别的模型（比如小米），只要填了这个 Key，语音照样能用。',
        keyPlaceholder: 'sk-...',
        keySave: '保存并开始',
        keySaving: '保存中…',
        keyGet: '去 platform.deepseek.com 获取 Key',
        keyCancel: '以后再说',
        keyBadFormat: 'Key 看起来不完整，DeepSeek 的 Key 形如 sk-xxxxxxxx。',
        keySaveFailed: '保存失败，请再试一次。',
        keyNeedsRestart: '这个 Host 还停留在旧版本，重启一次 Harness 后就能在插件里保存 Key。',
        apiKey: 'API Key',
        apiKeyChange: '更换',
        apiKeyMissing: '未配置',
        apiKeyConfigured: '已配置',
        modelRow: '对话模型',
        modelBuiltin: '插件内置',
        checking: '检查中…',
        hint: '语音由 DeepSeek 合成',
      },
      en: {
        launcher: 'Open Big Fat Fish voice chat',
        title: 'Big Fat Fish',
        subtitle: 'Voice chat with DeepSeek',
        pickTitle: 'Pick a voice',
        pickSub: 'This is the voice your fish will talk with',
        preview: 'Preview',
        previewText: 'Hi there, I am Big Fat Fish.',
        start: 'Start chatting',
        cancel: 'Cancel',
        settings: 'Settings',
        close: 'Close',
        voice: 'Voice',
        continuous: 'Continuous mode',
        continuousHint: 'Listen again after each answer',
        clear: 'Clear conversation',
        reselect: 'Pick another voice',
        listen: 'Tap the microphone and talk to me',
        listening: 'Listening…',
        thinking: 'Thinking…',
        speaking: 'Speaking…',
        idle: 'Tap the microphone to start',
        image: 'Send an image',
        attachHint: 'Ask about this image…',
        send: 'Send',
        micOn: 'Start talking',
        micOff: 'Stop',
        emptyAnswer: 'No answer came back this time. Try again.',
        asrEmpty: 'I did not catch that. Say it once more?',
        imageType: 'Only images can be sent.',
        imageTooBig: 'That image is too large, pick another one.',
        needMic: 'The browser has no microphone permission. Allow it in the address bar.',
        noMic: 'No microphone was found.',
        imagePrompt: 'Have a look at this image',
        typeHint: 'Type here, or tap the microphone',
        micSource: 'Microphone',
        micDefault: 'System default microphone',
        micFallback: 'Microphone',
        micRefresh: 'Refresh',
        micUnknown: 'Previously chosen microphone (disconnected)',
        micMissing: 'The chosen microphone was not found; using the system default.',
        micNeedPermission: 'Device names appear after the first recording',
        gateChecking: 'Checking the DeepSeek key…',
        keyTitle: 'Add a DeepSeek API key',
        keyWhy: 'Speech recognition, speech synthesis, and image reading all call the DeepSeek platform API with a DeepSeek key — the chat model selected in Harness plays no part.',
        keyWhy2: 'So even when Harness runs another provider (Xiaomi, for example), voice keeps working as long as this key is set.',
        keyPlaceholder: 'sk-...',
        keySave: 'Save and start',
        keySaving: 'Saving…',
        keyGet: 'Get a key at platform.deepseek.com',
        keyCancel: 'Not now',
        keyBadFormat: 'That key looks incomplete; DeepSeek keys look like sk-xxxxxxxx.',
        keySaveFailed: 'Could not save the key. Try again.',
        keyNeedsRestart: 'This Host build is older; restart Harness once to save the key from here.',
        apiKey: 'API key',
        apiKeyChange: 'Replace',
        apiKeyMissing: 'Not set',
        apiKeyConfigured: 'Configured',
        modelRow: 'Chat model',
        modelBuiltin: 'built in',
        checking: 'Checking…',
        hint: 'Speech synthesized by DeepSeek',
      },
    }

    let uid = 0
    function nextId() {
      uid += 1
      return `dfy-${String(uid)}`
    }

    function readStorage(key, fallback) {
      try {
        const value = window.localStorage.getItem(key)
        return typeof value === 'string' ? value : fallback
      } catch {
        return fallback
      }
    }

    function writeStorage(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* private mode: the choice simply does not outlive the page */
      }
    }

    /** Strip the markup a voice should never read aloud. */
    function cleanForSpeech(text) {
      return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_#>~|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const STRONG_STOPS = '。！？!?；;\n…'

    /** One request failure carrying the Host's error code, so the panel can react to a missing key. */
    function apiError(payload, fallback) {
      const detail = payload !== null && typeof payload === 'object' ? payload.error : undefined
      const message =
        detail !== null && typeof detail === 'object' && typeof detail.message === 'string' && detail.message.length > 0
          ? detail.message
          : fallback
      const error = new Error(message)
      if (detail !== null && typeof detail === 'object' && typeof detail.code === 'string') error.code = detail.code
      return error
    }

    /** Index just past the first complete sentence, or -1 while still growing. */
    function findSentenceEnd(text) {
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i]
        if (STRONG_STOPS.indexOf(ch) >= 0 && text.slice(0, i + 1).trim().length >= 4) return i + 1
        if (ch === '.' && i >= 20 && (i + 1 === text.length || /[\s"'”’]/.test(text[i + 1]))) return i + 1
      }
      if (text.length > 240) {
        const windowText = text.slice(0, 240)
        const cut = Math.max(windowText.lastIndexOf('，'), windowText.lastIndexOf(','), windowText.lastIndexOf(' '))
        return cut > 40 ? cut + 1 : 240
      }
      return -1
    }

    /** Linear resample to the ASR sample rate. */
    function resample(input, from, to) {
      if (from === to) return input
      const ratio = from / to
      const length = Math.max(1, Math.round(input.length / ratio))
      const output = new Float32Array(length)
      for (let i = 0; i < length; i += 1) {
        const position = i * ratio
        const low = Math.floor(position)
        const high = Math.min(input.length - 1, low + 1)
        const weight = position - low
        output[i] = input[low] * (1 - weight) + input[high] * weight
      }
      return output
    }

    function writeAscii(view, offset, text) {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
    }

    /** Encode mono float samples as a 16 kHz 16-bit PCM WAV blob. */
    function encodeWav(samples, sampleRate) {
      const pcm = resample(samples, sampleRate, 16_000)
      const buffer = new ArrayBuffer(44 + pcm.length * 2)
      const view = new DataView(buffer)
      writeAscii(view, 0, 'RIFF')
      view.setUint32(4, 36 + pcm.length * 2, true)
      writeAscii(view, 8, 'WAVE')
      writeAscii(view, 12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 16_000, true)
      view.setUint32(28, 16_000 * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      writeAscii(view, 36, 'data')
      view.setUint32(40, pcm.length * 2, true)
      let offset = 44
      for (let i = 0; i < pcm.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, pcm[i]))
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      }
      return new Blob([view], { type: 'audio/wav' })
    }

    /** Decode one picked image, shrink it, and return a JPEG data URL. */
    function downscaleImage(file, max) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const image = new Image()
        image.onload = () => {
          URL.revokeObjectURL(url)
          try {
            const longest = Math.max(image.naturalWidth, image.naturalHeight)
            const scale = longest > max ? max / longest : 1
            const width = Math.max(1, Math.round(image.naturalWidth * scale))
            const height = Math.max(1, Math.round(image.naturalHeight * scale))
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext('2d')
            if (context === null) throw new Error('canvas')
            context.drawImage(image, 0, 0, width, height)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          } catch (error) {
            reject(error)
          }
        }
        image.onerror = () => {
          URL.revokeObjectURL(url)
          reject(new Error('image'))
        }
        image.src = url
      })
    }

    /* ------------------------------------------------------------------ *
     * Audio: one bus (context + analysers), one recorder, one speaker
     * ------------------------------------------------------------------ */

    function createAudioBus() {
      let ctx = null
      let playAnalyser = null
      let micAnalyser = null
      let playData = null
      let micData = null

      function ensure() {
        if (ctx !== null) return ctx
        const AudioCtor = window.AudioContext || window.webkitAudioContext
        if (AudioCtor === undefined) throw new Error('这个浏览器不支持 Web Audio')
        ctx = new AudioCtor()
        playAnalyser = ctx.createAnalyser()
        playAnalyser.fftSize = 512
        playAnalyser.smoothingTimeConstant = 0.72
        playAnalyser.connect(ctx.destination)
        playData = new Uint8Array(playAnalyser.fftSize)

        micAnalyser = ctx.createAnalyser()
        micAnalyser.fftSize = 512
        micAnalyser.smoothingTimeConstant = 0.55
        const silent = ctx.createGain()
        silent.gain.value = 0
        micAnalyser.connect(silent)
        silent.connect(ctx.destination)
        micData = new Uint8Array(micAnalyser.fftSize)
        return ctx
      }

      function level(which) {
        const analyser = which === 'mic' ? micAnalyser : playAnalyser
        const data = which === 'mic' ? micData : playData
        if (analyser === null || data === null) return 0
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i += 1) {
          const value = (data[i] - 128) / 128
          sum += value * value
        }
        const rms = Math.sqrt(sum / data.length)
        return Math.min(1, rms * 4)
      }

      return {
        ensure,
        level,
        resume() {
          if (ctx !== null && ctx.state === 'suspended') ctx.resume().catch(() => {})
        },
        get context() {
          return ctx
        },
        get micAnalyser() {
          return micAnalyser
        },
        get playAnalyser() {
          return playAnalyser
        },
        dispose() {
          try {
            if (ctx !== null) ctx.close()
          } catch {
            /* already closed */
          }
          ctx = null
        },
      }
    }

    function createRecorder(bus) {
      const state = {
        stream: null,
        source: null,
        processor: null,
        chunks: [],
        rate: 16_000,
        startedAt: 0,
        lastLoudAt: 0,
        heard: false,
        recording: false,
        fallback: false,
      }

      return {
        isRecording() {
          return state.recording
        },
        heard() {
          return state.heard
        },
        usedFallback() {
          return state.fallback === true
        },
        elapsed() {
          return state.recording ? performance.now() - state.startedAt : 0
        },
        silentFor(ms) {
          return state.heard && performance.now() - state.lastLoudAt > ms
        },
        async start(deviceId) {
          if (state.recording) return
          const ctx = bus.ensure()
          bus.resume()
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('这个浏览器不支持录音')
          }
          const audio = {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
          state.fallback = false
          let stream
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio,
            })
          } catch (error) {
            const missing = error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError'
            if (!deviceId || !missing) throw error
            state.fallback = true
            stream = await navigator.mediaDevices.getUserMedia({ audio })
          }
          const source = ctx.createMediaStreamSource(stream)
          const processor = ctx.createScriptProcessor(4096, 1, 1)
          state.chunks = []
          state.rate = ctx.sampleRate
          state.startedAt = performance.now()
          state.lastLoudAt = state.startedAt
          state.heard = false
          state.recording = true
          processor.onaudioprocess = (event) => {
            const channel = event.inputBuffer.getChannelData(0)
            state.chunks.push(new Float32Array(channel))
            let sum = 0
            for (let i = 0; i < channel.length; i += 4) sum += channel[i] * channel[i]
            const rms = Math.sqrt(sum / (channel.length / 4))
            if (rms > 0.014) {
              state.lastLoudAt = performance.now()
              state.heard = true
            }
          }
          source.connect(processor)
          processor.connect(bus.micAnalyser)
          state.stream = stream
          state.source = source
          state.processor = processor
        },
        stop() {
          if (!state.recording) return null
          state.recording = false
          const durationMs = performance.now() - state.startedAt
          try {
            state.processor.disconnect()
          } catch {
            /* already detached */
          }
          try {
            state.source.disconnect()
          } catch {
            /* already detached */
          }
          if (state.stream !== null) {
            for (const track of state.stream.getTracks()) track.stop()
          }
          state.stream = null
          state.source = null
          state.processor = null
          const total = state.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const merged = new Float32Array(total)
          let offset = 0
          for (const chunk of state.chunks) {
            merged.set(chunk, offset)
            offset += chunk.length
          }
          state.chunks = []
          return { samples: merged, rate: state.rate, durationMs, heard: state.heard }
        },
        dispose() {
          if (state.recording) this.stop()
        },
      }
    }

    async function fetchSpeech(bus, text, voiceId) {
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice_id: voiceId }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => null)
        throw apiError(detail, `语音合成失败（HTTP ${String(response.status)}）`)
      }
      const bytes = await response.arrayBuffer()
      const ctx = bus.ensure()
      return await new Promise((resolve, reject) => {
        ctx.decodeAudioData(bytes.slice(0), resolve, reject)
      })
    }

    /** One sentence queue per answer; every turn gets a fresh speaker. */
    function createSpeaker(bus, hooks) {
      let queue = []
      let pumping = false
      let dead = false
      let current = null
      let idleWaiters = []

      function settle() {
        const waiters = idleWaiters
        idleWaiters = []
        for (const resolve of waiters) resolve()
      }

      function play(buffer) {
        return new Promise((resolve) => {
          const ctx = bus.ensure()
          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(bus.playAnalyser)
          source.onended = () => {
            if (current === source) current = null
            resolve()
          }
          current = source
          try {
            source.start()
          } catch {
            current = null
            resolve()
          }
        })
      }

      async function pump() {
        if (pumping) return
        pumping = true
        try {
          while (!dead && queue.length > 0) {
            const job = queue.shift()
            let buffer
            try {
              buffer = await job
            } catch (error) {
              if (!dead) hooks.onError(error)
              continue
            }
            if (dead) break
            await play(buffer)
          }
        } finally {
          pumping = false
        }
        settle()
      }

      return {
        enqueue(text, voiceId) {
          if (dead) return
          queue.push(fetchSpeech(bus, text, voiceId))
          void pump()
        },
        whenIdle() {
          if (queue.length === 0 && !pumping) return Promise.resolve()
          return new Promise((resolve) => idleWaiters.push(resolve))
        },
        stop() {
          dead = true
          queue = []
          if (current !== null) {
            try {
              current.stop()
            } catch {
              /* already ended */
            }
            current = null
          }
          settle()
        },
      }
    }

    /* ------------------------------------------------------------------ *
     * Icons and artwork
     * ------------------------------------------------------------------ */

    function FishMark({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' },
        h(
          'defs',
          null,
          h(
            'linearGradient',
            { id: 'dfy-fish-body', x1: '0', y1: '0', x2: '1', y2: '1' },
            h('stop', { offset: '0', stopColor: '#ffd8a8' }),
            h('stop', { offset: '0.55', stopColor: '#f3895c' }),
            h('stop', { offset: '1', stopColor: '#c4508b' }),
          ),
        ),
        h('path', {
          d: 'M14 39 C 20 25, 40 23, 50 34 C 40 46, 20 47, 14 39 Z',
          fill: 'url(#dfy-fish-body)',
        }),
        h('path', { d: 'M14 39 L 5 30 L 7 47 Z', fill: '#e0795a' }),
        h('circle', { cx: 41, cy: 34, r: 2.6, fill: '#22121a' }),
        h('path', {
          d: 'M52 29 C 56 32, 56 37, 52 40',
          fill: 'none',
          stroke: '#f7b199',
          strokeWidth: '2.2',
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M57 25 C 63 30, 63 40, 57 45',
          fill: 'none',
          stroke: '#f7b199',
          strokeWidth: '2.2',
          strokeLinecap: 'round',
          opacity: '0.55',
        }),
      )
    }

    /** The packaged illustration, falling back to the drawn mark if it cannot load. */
    function AssetMark({ url, size, className }) {
      const [broken, setBroken] = useState(false)
      if (broken) return h(FishMark, { size })
      return h('img', {
        className,
        src: url,
        alt: '',
        width: size,
        height: size,
        draggable: false,
        onError: () => setBroken(true),
      })
    }

    function IconGear() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', fill: 'none' },
        h('circle', { cx: '12', cy: '12', r: '3.2', stroke: 'currentColor', strokeWidth: '1.6' }),
        h('path', {
          d: 'M19.4 13.5a7.6 7.6 0 0 0 0-3l1.7-1.3-1.9-3.2-2 .8a7.7 7.7 0 0 0-2.6-1.5L14.3 3h-3.8l-.4 2.3A7.7 7.7 0 0 0 7.5 6.8l-2-.8-1.9 3.2L5.3 10.5a7.6 7.6 0 0 0 0 3l-1.7 1.3 1.9 3.2 2-.8a7.7 7.7 0 0 0 2.6 1.5l.4 2.3h3.8l.4-2.3a7.7 7.7 0 0 0 2.6-1.5l2 .8 1.9-3.2-1.8-1.3Z',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinejoin: 'round',
        }),
      )
    }

    function IconMic() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': 'true', fill: 'none' },
        h('rect', {
          x: '9',
          y: '3',
          width: '6',
          height: '11',
          rx: '3',
          stroke: 'currentColor',
          strokeWidth: '1.7',
        }),
        h('path', {
          d: 'M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3',
          stroke: 'currentColor',
          strokeWidth: '1.7',
          strokeLinecap: 'round',
        }),
      )
    }

    function IconStop() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true' },
        h('rect', { x: '7', y: '7', width: '10', height: '10', rx: '2.5', fill: 'currentColor' }),
      )
    }

    function IconImage() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 21, height: 21, 'aria-hidden': 'true', fill: 'none' },
        h('rect', {
          x: '3.5',
          y: '5',
          width: '17',
          height: '14',
          rx: '3',
          stroke: 'currentColor',
          strokeWidth: '1.6',
        }),
        h('circle', { cx: '9', cy: '10', r: '1.6', fill: 'currentColor' }),
        h('path', {
          d: 'M5 17l4.2-4.2a1.6 1.6 0 0 1 2.3 0L16 17',
          stroke: 'currentColor',
          strokeWidth: '1.6',
          strokeLinecap: 'round',
        }),
      )
    }

    function IconClose() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 19, height: 19, 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M6.5 6.5l11 11m0-11l-11 11',
          stroke: 'currentColor',
          strokeWidth: '1.8',
          strokeLinecap: 'round',
        }),
      )
    }

    function IconPlay() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
        h('path', { d: 'M8 5.5v13l10-6.5z', fill: 'currentColor' }),
      )
    }

    function IconSend() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' },
        h('path', { d: 'M4 12l16-7-5.5 16-3.5-6.5z', fill: 'currentColor' }),
      )
    }

    /* ------------------------------------------------------------------ *
     * Voice orb
     * ------------------------------------------------------------------ */

    function VoiceOrb({ status, size, getLevel }) {
      const coreRef = useRef(null)
      const haloRef = useRef(null)

      useEffect(() => {
        let frame = 0
        let smooth = 0
        const loop = () => {
          let target = 0
          try {
            target = getLevel()
          } catch {
            target = 0
          }
          smooth = smooth * 0.8 + Math.max(0, Math.min(1, target)) * 0.2
          const core = coreRef.current
          const halo = haloRef.current
          if (core !== null) core.style.transform = `scale(${(1 + smooth * 0.34).toFixed(4)})`
          if (halo !== null) {
            halo.style.transform = `scale(${(1.05 + smooth * 0.75).toFixed(4)})`
            halo.style.opacity = (0.16 + smooth * 0.62).toFixed(3)
          }
          frame = window.requestAnimationFrame(loop)
        }
        frame = window.requestAnimationFrame(loop)
        return () => window.cancelAnimationFrame(frame)
      }, [getLevel])

      return h(
        'div',
        {
          className: 'dfy-orb',
          'data-status': status,
          style: { width: `${String(size)}px`, height: `${String(size)}px` },
        },
        h('span', { className: 'dfy-orb-halo', ref: haloRef }),
        h('span', { className: 'dfy-orb-ring' }),
        h('span', { className: 'dfy-orb-core', ref: coreRef }),
      )
    }

    /** Keep the launcher fully inside the viewport. */
    function clampFab(position) {
      const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN)
      const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN)
      return {
        x: Math.min(Math.max(FAB_MARGIN, Math.round(position.x)), maxX),
        y: Math.min(Math.max(FAB_MARGIN, Math.round(position.y)), maxY),
      }
    }

    /** The launcher position the user left behind, or null for the default corner. */
    function readFabPosition() {
      const raw = readStorage(FAB_STORAGE, '')
      if (raw === '') return null
      try {
        const parsed = JSON.parse(raw)
        if (
          typeof parsed?.x === 'number' &&
          typeof parsed?.y === 'number' &&
          Number.isFinite(parsed.x) &&
          Number.isFinite(parsed.y)
        ) {
          return clampFab(parsed)
        }
      } catch {
        /* a broken record simply falls back to the corner */
      }
      return null
    }

    /**
     * Round launcher that can be dragged anywhere in the page.
     *
     * A pointer press arms a drag; moving past a small threshold turns the
     * press into a drag and the click that follows is swallowed, so opening
     * the panel and moving the button never fight each other. A plain click
     * (or Enter/Space) still toggles the panel, and the chosen spot survives
     * a reload.
     */
    function FloatingLauncher({ t, open, onToggle }) {
      const [position, setPosition] = useState(readFabPosition)
      const [dragging, setDragging] = useState(false)
      const nodeRef = useRef(null)
      const dragRef = useRef(null)
      const suppressClickUntilRef = useRef(0)

      useEffect(() => {
        const keepInside = () => setPosition((current) => (current === null ? current : clampFab(current)))
        window.addEventListener('resize', keepInside)
        return () => window.removeEventListener('resize', keepInside)
      }, [])

      const paint = (next) => {
        const node = nodeRef.current
        if (node === null) return
        node.style.left = `${next.x}px`
        node.style.top = `${next.y}px`
        node.style.right = 'auto'
        node.style.bottom = 'auto'
      }

      const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const node = nodeRef.current
        if (node === null) return
        const rect = node.getBoundingClientRect()
        dragRef.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          position: { x: Math.round(rect.left), y: Math.round(rect.top) },
        }
        setDragging(true)
        setPosition({ x: Math.round(rect.left), y: Math.round(rect.top) })
        try {
          node.setPointerCapture(event.pointerId)
        } catch {
          /* capture is a convenience, not a requirement */
        }
      }

      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        if (!drag.moved) {
          if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 4) return
          drag.moved = true
        }
        const next = clampFab({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY })
        drag.position = next
        setPosition(next)
        paint(next)
      }

      const endDrag = (event) => {
        const drag = dragRef.current
        if (drag === null) return
        dragRef.current = null
        setDragging(false)
        const node = nodeRef.current
        if (node !== null) {
          try {
            node.releasePointerCapture(event.pointerId)
          } catch {
            /* already released */
          }
        }
        if (!drag.moved) return
        suppressClickUntilRef.current = performance.now() + 400
        const next = clampFab(drag.position)
        setPosition(next)
        paint(next)
        writeStorage(FAB_STORAGE, JSON.stringify(next))
      }

      return h(
        'button',
        {
          ref: nodeRef,
          type: 'button',
          className: `dfy-fab${dragging ? ' is-dragging' : ''}`,
          style:
            position === null
              ? undefined
              : { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' },
          'aria-label': open ? t('close') : t('launcher'),
          title: open ? t('close') : t('launcher'),
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onDragStart: (event) => event.preventDefault(),
          onClick: () => {
            if (performance.now() < suppressClickUntilRef.current) return
            onToggle()
          },
        },
        h('span', { className: 'dfy-fab-halo' }),
        h(AssetMark, { url: MARK_URL, size: FAB_SIZE, className: 'dfy-fab-img' }),
      )
    }

    /* ------------------------------------------------------------------ *
     * First run — the DeepSeek key gate
     * ------------------------------------------------------------------ */

    /**
     * Ask for the DeepSeek key before anything else.
     *
     * Speech (ASR/TTS) and image reading are DeepSeek platform endpoints, so a
     * DeepSeek key is the only prerequisite; the Harness model selection never
     * enters the picture. The Host route stores it after a live check, and a
     * Host that predates that route still works through the shared credentials
     * remote.
     */
    function KeySetup({ t, notice, onSaved, onCancel }) {
      const [value, setValue] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(notice || '')

      const submit = async () => {
        const key = value.trim()
        if (key.length === 0 || busy) return
        setBusy(true)
        setError('')
        try {
          await onSaved(key)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'dfy-gate' },
        h('div', { className: 'dfy-gate-title' }, t('keyTitle')),
        h('p', { className: 'dfy-gate-text' }, t('keyWhy')),
        h('p', { className: 'dfy-gate-text dfy-gate-muted' }, t('keyWhy2')),
        h(
          'div',
          { className: 'dfy-gate-form' },
          h('input', {
            className: 'dfy-input dfy-gate-input',
            type: 'password',
            value,
            placeholder: t('keyPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'dfy-primary dfy-gate-save',
              disabled: busy || value.trim().length === 0,
              onClick: () => void submit(),
            },
            busy ? t('keySaving') : t('keySave'),
          ),
        ),
        error.length > 0 ? h('div', { className: 'dfy-error dfy-gate-error' }, error) : null,
        h(
          'div',
          { className: 'dfy-gate-actions' },
          h(
            'a',
            {
              className: 'dfy-gate-link',
              href: 'https://platform.deepseek.com/api_keys',
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            t('keyGet'),
          ),
          h('button', { type: 'button', className: 'dfy-ghost', onClick: onCancel }, t('keyCancel')),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Panel
     * ------------------------------------------------------------------ */

    function Panel({ t, saveKey }) {
      const [open, setOpen] = useState(false)
      const [gate, setGate] = useState({ state: 'checking', message: '' })
      const [chosen, setChosen] = useState(() => readStorage(STORAGE_VOICE, '') !== '')
      const [voice, setVoice] = useState(() => {
        const stored = readStorage(STORAGE_VOICE, '')
        return VOICES.some((entry) => entry.id === stored) ? stored : 'stella'
      })
      const [continuous, setContinuous] = useState(() => readStorage(STORAGE_CONTINUOUS, '1') === '1')
      const [messages, setMessages] = useState([])
      const [settingsOpen, setOpenSettings] = useState(false)
      const historyRef = useRef([])

      const close = () => {
        setOpen(false)
        setOpenSettings(false)
      }

      const checkStatus = async () => {
        try {
          const response = await fetch(STATUS_ENDPOINT, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`status ${String(response.status)}`)
          const data = await response.json()
          if (data !== null && typeof data === 'object' && data.ready === true) {
            setGate({ state: 'ready', message: '', masked: typeof data.masked === 'string' ? data.masked : '' })
          } else {
            setGate({
              state: 'key',
              message: typeof data?.message === 'string' ? data.message : '',
            })
          }
        } catch {
          // A missing status route must not lock the panel; the real endpoints
          // report their own errors if anything is wrong.
          setGate({ state: 'ready', message: '', masked: '' })
        }
      }

      useEffect(() => {
        if (!open) return
        setGate({ state: 'checking', message: '' })
        void checkStatus()
      }, [open])

      const submitKey = async (key) => {
        await saveKey(key)
        setGate({ state: 'ready', message: '', masked: '' })
      }

      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [open])

      const chooseVoice = (id) => {
        setVoice(id)
        writeStorage(STORAGE_VOICE, id)
      }
      const setContinuousMode = (value) => {
        setContinuous(value)
        writeStorage(STORAGE_CONTINUOUS, value ? '1' : '0')
      }
      const startChat = () => {
        writeStorage(STORAGE_VOICE, voice)
        setChosen(true)
      }
      const clearConversation = () => {
        historyRef.current = []
        setMessages([])
      }

      return h(
        'div',
        { className: 'dfy-root' },
        h(FloatingLauncher, {
          t,
          open,
          onToggle: () => {
            if (open) close()
            else setOpen(true)
          },
        }),
        open
          ? h(
              'div',
              {
                className: 'dfy-scrim',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) close()
                },
              },
              h(
                'div',
                { className: 'dfy-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title') },
                h(
                  'header',
                  { className: 'dfy-head' },
                  h(
                    'span',
                    { className: 'dfy-head-mark' },
                    h(AssetMark, { url: MARK_URL, size: 34, className: 'dfy-head-img' }),
                  ),
                  h(
                    'span',
                    { className: 'dfy-head-text' },
                    h('span', { className: 'dfy-head-title' }, t('title')),
                    h(
                      'span',
                      { className: 'dfy-head-sub' },
                      chosen ? `${t('voice')} · ${voiceLabel(voice)}` : t('subtitle'),
                    ),
                  ),
                  chosen
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dfy-icon-btn',
                          'aria-label': t('settings'),
                          title: t('settings'),
                          onClick: () => setOpenSettings((value) => !value),
                        },
                        h(IconGear),
                      )
                    : null,
                ),
                gate.state === 'checking'
                  ? h(
                      'div',
                      { className: 'dfy-gate dfy-gate-checking' },
                      h('span', { className: 'dfy-gate-spinner' }),
                      h('span', null, t('gateChecking')),
                    )
                  : gate.state === 'key'
                  ? h(KeySetup, {
                      t,
                      notice: gate.message,
                      onSaved: submitKey,
                      onCancel: close,
                    })
                  : chosen
                    ? h(ChatScreen, {
                        t,
                        voice,
                        continuous,
                        setContinuousMode,
                        messages,
                        setMessages,
                        historyRef,
                        chooseVoice,
                        clearConversation,
                        reselect: () => setChosen(false),
                        onClose: close,
                        openSettings: settingsOpen,
                        setOpenSettings,
                        apiKeyMasked: gate.masked ?? '',
                        apiKeyReady: gate.state === 'ready',
                        onOpenKey: (message) => setGate({ state: 'key', message: message ?? '' }),
                      })
                    : h(VoicePicker, {
                        t,
                        voice,
                        chooseVoice,
                        onStart: startChat,
                        onCancel: close,
                      }),
              ),
            )
          : null,
      )
    }

    function voiceLabel(id) {
      const entry = VOICES.find((candidate) => candidate.id === id)
      return entry === undefined ? id : `${entry.name} ${entry.alias} · ${entry.gender}`
    }

    /* ------------------------------------------------------------------ *
     * Step 1 — voice picker
     * ------------------------------------------------------------------ */

    function VoicePicker({ t, voice, chooseVoice, onStart, onCancel }) {
      const [playing, setPlaying] = useState('')
      const busRef = useRef(null)

      useEffect(
        () => () => {
          if (busRef.current !== null) busRef.current.dispose()
        },
        [],
      )

      const preview = async (id) => {
        if (playing.length > 0) return
        setPlaying(id)
        try {
          if (busRef.current === null) busRef.current = createAudioBus()
          const bus = busRef.current
          const ctx = bus.ensure()
          bus.resume()
          const buffer = await fetchSpeech(bus, t('previewText'), id)
          await new Promise((resolve) => {
            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.connect(bus.playAnalyser)
            source.onended = resolve
            source.start()
          })
        } catch {
          /* a failed preview must not break the picker */
        } finally {
          setPlaying('')
        }
      }

      return h(
        'div',
        { className: 'dfy-picker' },
        h('div', { className: 'dfy-picker-title' }, t('pickTitle')),
        h('div', { className: 'dfy-picker-sub' }, t('pickSub')),
        h(
          'div',
          { className: 'dfy-voices' },
          VOICES.map((entry) =>
            h(
              'div',
              {
                key: entry.id,
                className: 'dfy-voice',
                'data-active': String(entry.id === voice),
                role: 'button',
                tabIndex: 0,
                onClick: () => chooseVoice(entry.id),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') chooseVoice(entry.id)
                },
              },
              h('span', { className: 'dfy-voice-avatar', style: { background: entry.gradient } }, entry.alias),
              h('span', { className: 'dfy-voice-name' }, entry.name),
              h('span', { className: 'dfy-voice-meta' }, `${entry.gender} · ${entry.blurb}`),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dfy-preview',
                  onClick: (event) => {
                    event.stopPropagation()
                    void preview(entry.id)
                  },
                  'aria-label': t('preview'),
                },
                h(IconPlay),
                h('span', null, playing === entry.id ? '…' : t('preview')),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dfy-picker-actions' },
          h(
            'button',
            { type: 'button', className: 'dfy-primary', onClick: onStart },
            t('start'),
          ),
          h('button', { type: 'button', className: 'dfy-ghost', onClick: onCancel }, t('cancel')),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Step 2 — chat
     * ------------------------------------------------------------------ */

    function ChatScreen(props) {
      const {
        t,
        voice,
        continuous,
        setContinuousMode,
        messages,
        setMessages,
        historyRef,
        chooseVoice,
        clearConversation,
        reselect,
        onClose,
        openSettings,
        setOpenSettings,
        apiKeyMasked,
        apiKeyReady,
        onOpenKey,
      } = props

      const [status, setStatus] = useState('idle')
      const [error, setError] = useState('')
      const [draft, setDraft] = useState('')
      const [pendingImage, setPendingImage] = useState(null)
      const [textMode, setTextMode] = useState(false)
      const [micDevices, setMicDevices] = useState([])
      const [micDeviceId, setMicDeviceId] = useState(() => readStorage(MIC_STORAGE, ''))

      const statusRef = useRef('idle')
      const voiceRef = useRef(voice)
      const continuousRef = useRef(continuous)
      const micDeviceRef = useRef(micDeviceId)
      const busRef = useRef(null)
      const recorderRef = useRef(null)
      const speakerRef = useRef(null)
      const turnRef = useRef(null)
      const abortRef = useRef(null)
      const watcherRef = useRef(0)
      const errorTimerRef = useRef(0)
      const pendingImageRef = useRef(null)
      const aliveRef = useRef(true)
      const listRef = useRef(null)
      const fileRef = useRef(null)
      const startRef = useRef(null)
      const stopRef = useRef(null)

      voiceRef.current = voice
      continuousRef.current = continuous
      micDeviceRef.current = micDeviceId
      pendingImageRef.current = pendingImage

      const setPhase = useCallback((next) => {
        statusRef.current = next
        if (aliveRef.current) setStatus(next)
      }, [])

      const reportError = useCallback(
        (value) => {
          const message = value instanceof Error ? value.message : String(value)
          const code = value && typeof value === 'object' ? value.code : undefined
          if (code === 'missing-credential' || code === 'unauthorized') {
            if (typeof onOpenKey === 'function') onOpenKey(message)
            return
          }
          if (!aliveRef.current) return
          setError(message)
          window.clearTimeout(errorTimerRef.current)
          errorTimerRef.current = window.setTimeout(() => {
            if (aliveRef.current) setError('')
          }, 9000)
        },
        [onOpenKey],
      )

      const refreshMics = useCallback(async () => {
        try {
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return
          const all = await navigator.mediaDevices.enumerateDevices()
          const seen = new Set()
          const inputs = []
          for (const device of all) {
            if (device.kind !== 'audioinput') continue
            const key = device.deviceId === '' ? 'default' : device.deviceId
            if (seen.has(key)) continue
            seen.add(key)
            inputs.push({
              id: device.deviceId,
              label: device.label || `${t('micFallback')} ${String(inputs.length + 1)}`,
            })
          }
          if (aliveRef.current) setMicDevices(inputs)
        } catch {
          /* enumeration is a convenience: recording still uses the system default */
        }
      }, [t])

      useEffect(() => {
        void refreshMics()
        const media = navigator.mediaDevices
        if (!media || typeof media.addEventListener !== 'function') return undefined
        const onChange = () => void refreshMics()
        media.addEventListener('devicechange', onChange)
        return () => media.removeEventListener('devicechange', onChange)
      }, [refreshMics])

      const getBus = useCallback(() => {
        if (busRef.current === null) busRef.current = createAudioBus()
        return busRef.current
      }, [])

      const getRecorder = useCallback(() => {
        if (recorderRef.current === null) recorderRef.current = createRecorder(getBus())
        return recorderRef.current
      }, [getBus])

      const getLevel = useCallback(() => {
        const phase = statusRef.current
        if (phase === 'listening' || phase === 'speaking') {
          const bus = busRef.current
          if (bus === null) return 0
          return bus.level(phase === 'listening' ? 'mic' : 'play')
        }
        const now = performance.now() / 1000
        if (phase === 'thinking') return 0.26 + 0.18 * Math.sin(now * 3.4)
        return 0.07 + 0.05 * Math.sin(now * 0.9)
      }, [])

      const stopWatcher = useCallback(() => {
        if (watcherRef.current !== 0) {
          window.clearInterval(watcherRef.current)
          watcherRef.current = 0
        }
      }, [])

      const interrupt = useCallback(() => {
        const turn = turnRef.current
        if (turn !== null) turn.cancelled = true
        if (abortRef.current !== null) {
          try {
            abortRef.current.abort()
          } catch {
            /* noop */
          }
          abortRef.current = null
        }
        if (speakerRef.current !== null) speakerRef.current.stop()
        stopWatcher()
        const recorder = recorderRef.current
        if (recorder !== null && recorder.isRecording()) recorder.stop()
        setPhase('idle')
      }, [setPhase, stopWatcher])

      const chooseMic = useCallback(
        (deviceId) => {
          setMicDeviceId(deviceId)
          writeStorage(MIC_STORAGE, deviceId)
          if (statusRef.current === 'listening') {
            interrupt()
            const start = startRef.current
            if (start !== null) window.setTimeout(() => void start(), 60)
          }
        },
        [interrupt],
      )

      const sendTurn = useCallback(
        async (text, image) => {
          const trimmed = typeof text === 'string' ? text.trim() : ''
          if (trimmed.length === 0 && typeof image !== 'string') return
          const turn = { cancelled: false }
          turnRef.current = turn
          const controller = new AbortController()
          abortRef.current = controller

          historyRef.current = [
            ...historyRef.current,
            { role: 'user', text: trimmed, image: typeof image === 'string' ? image : undefined },
          ]
          const answerId = nextId()
          setMessages((previous) => [
            ...previous,
            { id: nextId(), role: 'user', text: trimmed, image: typeof image === 'string' ? image : undefined },
            { id: answerId, role: 'assistant', text: '' },
          ])
          setError('')
          setPhase('thinking')

          const bus = getBus()
          const speaker = createSpeaker(bus, { onError: reportError })
          speakerRef.current = speaker

          let pending = ''
          let answer = ''
          const pushSentence = (raw) => {
            const clean = cleanForSpeech(raw)
            if (clean.length === 0) return
            speaker.enqueue(clean, voiceRef.current)
            if (statusRef.current !== 'speaking') setPhase('speaking')
          }
          const flush = (final) => {
            for (;;) {
              const cut = findSentenceEnd(pending)
              if (cut <= 0) break
              const sentence = pending.slice(0, cut)
              pending = pending.slice(cut)
              pushSentence(sentence)
            }
            if (final) {
              pushSentence(pending)
              pending = ''
            }
          }

          const wireMessages = historyRef.current.slice(-20).map((message) => ({
            role: message.role,
            text: message.text,
            image: message.image,
          }))

          try {
            const response = await fetch(CHAT_ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ messages: wireMessages }),
              signal: controller.signal,
            })
            if (!response.ok || response.body === null) {
              const detail = await response.json().catch(() => null)
              throw apiError(detail, `对话失败（HTTP ${String(response.status)}）`)
            }
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (;;) {
              const chunk = await reader.read()
              if (chunk.done) break
              buffer += decoder.decode(chunk.value, { stream: true })
              let boundary = buffer.indexOf('\n\n')
              while (boundary >= 0) {
                const frame = buffer.slice(0, boundary)
                buffer = buffer.slice(boundary + 2)
                boundary = buffer.indexOf('\n\n')
                const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))
                if (line === undefined) continue
                let event
                try {
                  event = JSON.parse(line.slice(5).trim())
                } catch {
                  continue
                }
                if (event.error) throw apiError(event, '对话失败')
                if (typeof event.delta === 'string' && event.delta.length > 0) {
                  answer += event.delta
                  pending += event.delta
                  setMessages((previous) =>
                    previous.map((message) =>
                      message.id === answerId ? { ...message, text: answer } : message,
                    ),
                  )
                  flush(false)
                }
              }
              if (turn.cancelled) return
            }

            flush(true)
            if (turn.cancelled) return
            if (answer.trim().length === 0) {
              const fallback = t('emptyAnswer')
              setMessages((previous) =>
                previous.map((message) => (message.id === answerId ? { ...message, text: fallback } : message)),
              )
            } else {
              historyRef.current = [...historyRef.current, { role: 'assistant', text: answer }]
            }
            await speaker.whenIdle()
            if (turn.cancelled || !aliveRef.current) return
            setPhase('idle')
            if (continuousRef.current) {
              const start = startRef.current
              if (start !== null) void start()
            }
          } catch (cause) {
            if (turn.cancelled || cause?.name === 'AbortError') return
            reportError(cause)
            if (answer.trim().length > 0) {
              historyRef.current = [...historyRef.current, { role: 'assistant', text: answer }]
            }
            if (aliveRef.current) setPhase('idle')
          }
        },
        [getBus, historyRef, reportError, setMessages, setPhase, t],
      )

      const stopListening = useCallback(async () => {
        if (statusRef.current !== 'listening') return
        stopWatcher()
        const recorder = recorderRef.current
        const capture = recorder === null ? null : recorder.stop()
        if (capture === null || !capture.heard || capture.durationMs < 450 || capture.samples.length === 0) {
          setPhase('idle')
          return
        }
        setPhase('thinking')
        try {
          const blob = encodeWav(capture.samples, capture.rate)
          const response = await fetch(ASR_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'audio/wav' },
            body: blob,
          })
          if (!response.ok) {
            const detail = await response.json().catch(() => null)
            throw apiError(detail, `语音识别失败（HTTP ${String(response.status)}）`)
          }
          const payload = await response.json()
          const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
          if (text.length === 0) {
            reportError(new Error(t('asrEmpty')))
            setPhase('idle')
            return
          }
          const image = pendingImageRef.current === null ? undefined : pendingImageRef.current.url
          setPendingImage(null)
          await sendTurn(text, image)
        } catch (cause) {
          reportError(cause)
          if (aliveRef.current) setPhase('idle')
        }
      }, [reportError, sendTurn, setPhase, stopWatcher, t])

      const startListening = useCallback(async () => {
        if (statusRef.current === 'listening') return
        setError('')
        const recorder = getRecorder()
        try {
          await recorder.start(micDeviceRef.current)
        } catch (cause) {
          const name = cause?.name ?? ''
          if (name === 'NotAllowedError' || name === 'SecurityError') reportError(new Error(t('needMic')))
          else reportError(new Error(t('noMic')))
          setTextMode(true)
          setPhase('idle')
          return
        }
        if (!aliveRef.current) {
          recorder.stop()
          return
        }
        if (recorder.usedFallback() && micDeviceRef.current !== '') {
          micDeviceRef.current = ''
          setMicDeviceId('')
          writeStorage(MIC_STORAGE, '')
          reportError(new Error(t('micMissing')))
        }
        void refreshMics()
        setPhase('listening')
        stopWatcher()
        watcherRef.current = window.setInterval(() => {
          const active = recorderRef.current
          if (active === null || statusRef.current !== 'listening') {
            stopWatcher()
            return
          }
          if (active.elapsed() > MAX_RECORD_MS || active.silentFor(SILENCE_MS)) {
            const stop = stopRef.current
            if (stop !== null) void stop()
          }
        }, 120)
      }, [getRecorder, refreshMics, reportError, setPhase, stopWatcher, t])

      stopRef.current = stopListening
      startRef.current = startListening

      const handleMic = useCallback(() => {
        const phase = statusRef.current
        if (phase === 'listening') {
          void stopListening()
          return
        }
        if (phase === 'thinking' || phase === 'speaking') interrupt()
        void startListening()
      }, [interrupt, startListening, stopListening])

      const pickImage = useCallback(() => {
        if (fileRef.current !== null) fileRef.current.click()
      }, [])

      const onFile = useCallback(
        async (event) => {
          const file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          if (!/^image\//i.test(file.type)) {
            reportError(new Error(t('imageType')))
            return
          }
          if (file.size > 24 * 1024 * 1024) {
            reportError(new Error(t('imageTooBig')))
            return
          }
          try {
            const url = await downscaleImage(file, 1024)
            if (!aliveRef.current) return
            setPendingImage({ url, name: file.name })
            if (statusRef.current === 'idle') void startListening()
          } catch {
            reportError(new Error(t('imageType')))
          }
        },
        [reportError, startListening, t],
      )

      const submitDraft = useCallback(() => {
        if (statusRef.current === 'thinking' || statusRef.current === 'speaking' || statusRef.current === 'listening') {
          interrupt()
        }
        const text = draft.trim() || (pendingImage === null ? '' : t('imagePrompt'))
        const image = pendingImage === null ? undefined : pendingImage.url
        if (text.length === 0 && image === undefined) return
        setDraft('')
        setPendingImage(null)
        void sendTurn(text, image)
      }, [draft, interrupt, pendingImage, sendTurn, t])

      useEffect(() => {
        aliveRef.current = true
        return () => {
          aliveRef.current = false
          window.clearTimeout(errorTimerRef.current)
          const turn = turnRef.current
          if (turn !== null) turn.cancelled = true
          if (abortRef.current !== null) {
            try {
              abortRef.current.abort()
            } catch {
              /* noop */
            }
          }
          if (speakerRef.current !== null) speakerRef.current.stop()
          if (watcherRef.current !== 0) window.clearInterval(watcherRef.current)
          if (recorderRef.current !== null) recorderRef.current.dispose()
          if (busRef.current !== null) busRef.current.dispose()
        }
      }, [])

      useEffect(() => {
        const node = listRef.current
        if (node !== null) node.scrollTop = node.scrollHeight
      }, [messages, status])

      const phaseText =
        status === 'listening'
          ? t('listening')
          : status === 'thinking'
            ? t('thinking')
            : status === 'speaking'
              ? t('speaking')
              : messages.length === 0
                ? t('listen')
                : t('idle')

      const empty = messages.length === 0

      return h(
        'div',
        {
          className: 'dfy-chat',
          onMouseDown: () => {
            try {
              getBus().resume()
            } catch {
              /* no audio context yet: nothing to resume */
            }
            if (openSettings) setOpenSettings(false)
          },
        },
        openSettings
          ? h(SettingsSheet, {
              t,
              voice,
              chooseVoice,
              continuous,
              setContinuousMode,
              clearConversation,
              reselect,
              micDevices,
              micDeviceId,
              chooseMic,
              refreshMics,
              apiKeyMasked,
              apiKeyReady,
              onOpenKey,
              onClose: () => setOpenSettings(false),
            })
          : null,
        h(
          'div',
          { className: 'dfy-messages', ref: listRef, 'data-empty': String(empty) },
          empty ? null : messages.map((message) => messageBubble(message, t)),
        ),
        h(
          'div',
          { className: 'dfy-stage', 'data-empty': String(empty) },
          h(VoiceOrb, { status, size: empty ? 148 : 82, getLevel }),
          h('div', { className: 'dfy-status', 'data-status': status }, phaseText),
        ),
        error.length > 0 ? h('div', { className: 'dfy-error', role: 'status' }, error) : null,
        pendingImage === null && !textMode
          ? null
          : h(
              'div',
              { className: 'dfy-compose' },
              pendingImage === null
                ? null
                : h('img', { className: 'dfy-compose-thumb', src: pendingImage.url, alt: '' }),
              h('input', {
                className: 'dfy-input',
                value: draft,
                placeholder: pendingImage === null ? t('typeHint') : t('attachHint'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitDraft()
                  }
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dfy-send',
                  'aria-label': t('send'),
                  title: t('send'),
                  onClick: submitDraft,
                },
                h(IconSend),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dfy-icon-btn dfy-compose-x',
                  'aria-label': t('close'),
                  title: t('close'),
                  onClick: () => setPendingImage(null),
                },
                h(IconClose),
              ),
            ),
        h(
          'div',
          { className: 'dfy-controls' },
          h(
            'button',
            {
              type: 'button',
              className: `dfy-ctl dfy-ctl-primary${status === 'listening' ? ' is-live' : ''}${status === 'speaking' || status === 'thinking' ? ' is-busy' : ''}`,
              'aria-label': status === 'listening' ? t('micOff') : t('micOn'),
              title: status === 'listening' ? t('micOff') : t('micOn'),
              onClick: handleMic,
            },
            status === 'listening' ? h(IconStop) : h(IconMic),
          ),
          h(
            'button',
            {
              type: 'button',
              className: `dfy-ctl${pendingImage === null ? '' : ' is-active'}`,
              'aria-label': t('image'),
              title: t('image'),
              onClick: pickImage,
            },
            h(IconImage),
          ),
          h(
            'button',
            { type: 'button', className: 'dfy-ctl', 'aria-label': t('close'), title: t('close'), onClick: onClose },
            h(IconClose),
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/png,image/jpeg,image/webp,image/gif',
            className: 'dfy-file',
            onChange: onFile,
          }),
        ),
        h('div', { className: 'dfy-hint' }, t('hint')),
      )
    }

    function messageBubble(message, t) {
      return h(
        'div',
        { key: message.id, className: 'dfy-msg', 'data-role': message.role },
        h(
          'div',
          { className: 'dfy-bubble' },
          message.image === undefined
            ? null
            : h('img', { className: 'dfy-bubble-img', src: message.image, alt: t('image') }),
          message.text.length === 0 ? null : h('span', null, message.text),
        ),
      )
    }

    function SettingsSheet({
      t,
      voice,
      chooseVoice,
      continuous,
      setContinuousMode,
      clearConversation,
      reselect,
      micDevices,
      micDeviceId,
      chooseMic,
      refreshMics,
      apiKeyMasked,
      apiKeyReady,
      onOpenKey,
      onClose,
    }) {
      const knownMic = micDevices.some((device) => device.id === micDeviceId)
      const micLabel =
        micDeviceId === ''
          ? t('micDefault')
          : knownMic
            ? micDevices.find((device) => device.id === micDeviceId).label
            : t('micUnknown')
      return h(
        'div',
        { className: 'dfy-settings', onMouseDown: (event) => event.stopPropagation() },
        h(
          'div',
          { className: 'dfy-setting-row dfy-setting-row-stack' },
          h(
            'span',
            { className: 'dfy-setting-label' },
            t('micSource'),
            h(
              'button',
              {
                type: 'button',
                className: 'dfy-setting-mini',
                title: t('micRefresh'),
                onClick: () => refreshMics(),
              },
              t('micRefresh'),
            ),
          ),
          h(
            'select',
            {
              className: 'dfy-select',
              value: micDeviceId === '' || knownMic ? micDeviceId : '',
              title: micLabel,
              onChange: (event) => chooseMic(event.target.value),
            },
            h('option', { value: '' }, t('micDefault')),
            micDevices.map((device, index) =>
              h('option', { key: `${device.id}-${String(index)}`, value: device.id }, device.label),
            ),
          ),
          micDevices.length === 0
            ? h('span', { className: 'dfy-setting-hint' }, t('micNeedPermission'))
            : null,
        ),
        h(
          'div',
          { className: 'dfy-setting-row' },
          h('span', null, t('voice')),
          h(
            'span',
            { className: 'dfy-seg' },
            VOICES.map((entry) =>
              h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  'data-active': String(entry.id === voice),
                  onClick: () => chooseVoice(entry.id),
                },
                `${entry.name} ${entry.gender}`,
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dfy-setting-row' },
          h(
            'span',
            null,
            t('continuous'),
            h('br'),
            h('span', { className: 'dfy-setting-hint' }, t('continuousHint')),
          ),
          h('button', {
            type: 'button',
            className: 'dfy-switch',
            role: 'switch',
            'aria-checked': String(continuous),
            'aria-label': t('continuous'),
            onClick: () => setContinuousMode(!continuous),
          }),
        ),
        h(
          'div',
          { className: 'dfy-setting-row' },
          h(
            'span',
            null,
            t('apiKey'),
            h('br'),
            h(
              'span',
              { className: 'dfy-setting-hint' },
              apiKeyMasked.length > 0 ? apiKeyMasked : apiKeyReady ? t('apiKeyConfigured') : t('apiKeyMissing'),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dfy-setting-mini',
              onClick: () => {
                onClose()
                if (typeof onOpenKey === 'function') onOpenKey('')
              },
            },
            t('apiKeyChange'),
          ),
        ),
        h(
          'div',
          { className: 'dfy-setting-row' },
          h('span', null, t('modelRow')),
          h('span', { className: 'dfy-setting-hint' }, `deepseek-flash · ${t('modelBuiltin')}`),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dfy-setting-action',
            onClick: () => {
              clearConversation()
              onClose()
            },
          },
          t('clear'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dfy-setting-action',
            onClick: () => {
              reselect()
              onClose()
            },
          },
          t('reselect'),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const STYLES = `
.dfy-root{position:fixed;inset:0;pointer-events:none;z-index:60;font-family:inherit;color:var(--dsw-alias-label-primary)}
.dfy-root *,.dfy-root *::before,.dfy-root *::after{box-sizing:border-box}
.dfy-fab{pointer-events:auto;position:fixed;right:22px;bottom:112px;width:52px;height:52px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:grid;place-items:center;cursor:grab;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:0;transition:box-shadow .16s ease;touch-action:none;user-select:none;-webkit-user-select:none}
.dfy-fab-img{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:center 38%;user-select:none;-webkit-user-drag:none}
.dfy-fab:hover{box-shadow:0 14px 32px rgba(0,0,0,.34)}
.dfy-fab:active{transform:scale(.96)}
.dfy-fab.is-dragging{cursor:grabbing;transform:scale(1.05);box-shadow:0 18px 40px rgba(0,0,0,.4);transition:none}
.dfy-fab.is-dragging .dfy-fab-halo{opacity:.5}
.dfy-fab-halo{position:absolute;inset:-6px;border-radius:50%;border:1px solid var(--dsw-alias-brand-primary);opacity:.28;animation:dfy-breathe 3.4s ease-in-out infinite;pointer-events:none}
.dfy-scrim{pointer-events:auto;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(6,8,14,.6);background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px)}
.dfy-panel{position:relative;display:flex;flex-direction:column;width:min(560px,100%);height:min(768px,100%);border-radius:26px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 34px 96px rgba(0,0,0,.46);animation:dfy-in .2s ease-out}
.dfy-head{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;flex:0 0 auto}
.dfy-head-mark{width:34px;height:34px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);display:grid;place-items:center;flex:0 0 auto;overflow:hidden}
.dfy-head-img{display:block;width:100%;height:100%;border-radius:11px;object-fit:cover;object-position:center 36%;user-select:none;-webkit-user-drag:none}
.dfy-head-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.dfy-head-title{font-size:14px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dfy-head-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dfy-icon-btn{width:34px;height:34px;flex:0 0 auto;border-radius:10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);display:grid;place-items:center;cursor:pointer;padding:0;transition:background .14s,color .14s}
.dfy-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dfy-picker{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:12px 24px 28px;min-height:0}
.dfy-picker-title{font-size:24px;font-weight:600;letter-spacing:.02em;text-align:center}
.dfy-picker-sub{font-size:12px;color:var(--dsw-alias-label-secondary);text-align:center;margin-top:-10px}
.dfy-voices{display:flex;gap:14px;width:100%;max-width:420px}
.dfy-voice{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:7px;padding:18px 12px 14px;border-radius:18px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:border-color .16s,transform .16s,box-shadow .16s;outline:none}
.dfy-voice:hover{transform:translateY(-2px)}
.dfy-voice:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.dfy-voice[data-active="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.dfy-voice-avatar{width:70px;height:70px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:20px;font-weight:600;letter-spacing:.04em;box-shadow:inset 0 2px 12px rgba(255,255,255,.35)}
.dfy-voice-name{font-size:15px;font-weight:600}
.dfy-voice-meta{font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center}
.dfy-preview{display:inline-flex;align-items:center;gap:5px;margin-top:2px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}
.dfy-preview:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.dfy-picker-actions{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:4px}
.dfy-primary{height:44px;min-width:200px;padding:0 26px;border-radius:999px;border:0;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);font-size:14px;font-weight:600;cursor:pointer;transition:opacity .14s}
.dfy-primary:hover{opacity:.9}
.dfy-ghost{height:36px;padding:0 18px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.dfy-ghost:hover{color:var(--dsw-alias-label-primary)}
.dfy-chat{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;position:relative}
.dfy-messages{flex:1 1 auto;min-height:60px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px;padding:4px 20px 8px;scrollbar-width:thin}
.dfy-messages[data-empty="true"]{display:none}
.dfy-msg{display:flex}
.dfy-msg[data-role="user"]{justify-content:flex-end}
.dfy-bubble{max-width:84%;padding:9px 13px;border-radius:16px;font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.dfy-msg[data-role="user"] .dfy-bubble{background:var(--dsw-alias-bg-layer-2);border-bottom-right-radius:6px}
.dfy-msg[data-role="assistant"] .dfy-bubble{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-bottom-left-radius:6px}
.dfy-bubble-img{display:block;max-width:190px;max-height:190px;border-radius:10px;margin-bottom:6px}
.dfy-stage{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:6px 0 4px}
.dfy-stage[data-empty="true"]{flex:1 1 auto}
.dfy-status{font-size:12px;color:var(--dsw-alias-label-secondary);min-height:17px;text-align:center}
.dfy-status[data-status="listening"]{color:var(--dsw-alias-state-error-primary)}
.dfy-status[data-status="speaking"]{color:var(--dsw-alias-brand-primary)}
.dfy-error{margin:0 20px 6px;padding:8px 12px;border-radius:10px;font-size:12px;line-height:1.45;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.dfy-compose{display:flex;align-items:center;gap:8px;padding:0 18px 8px}
.dfy-compose-thumb{width:34px;height:34px;border-radius:8px;object-fit:cover;flex:0 0 auto;border:1px solid var(--dsw-alias-border-l1)}
.dfy-input{flex:1 1 auto;min-width:0;height:36px;padding:0 13px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none;font-family:inherit}
.dfy-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dfy-input::placeholder{color:var(--dsw-alias-label-secondary)}
.dfy-send{width:36px;height:36px;flex:0 0 auto;border-radius:50%;border:0;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);display:grid;place-items:center;cursor:pointer;padding:0}
.dfy-send:hover{opacity:.88}
.dfy-compose-x{width:30px;height:30px}
.dfy-controls{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:20px;padding:6px 0 10px}
.dfy-ctl{width:52px;height:52px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);display:grid;place-items:center;cursor:pointer;padding:0;transition:transform .14s,background .14s,color .14s,border-color .14s}
.dfy-ctl:hover{transform:translateY(-1px)}
.dfy-ctl:active{transform:scale(.95)}
.dfy-ctl-primary{width:60px;height:60px}
.dfy-ctl-primary.is-live{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:#fff;box-shadow:0 0 0 6px color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent);animation:dfy-pulse 1.6s ease-in-out infinite}
.dfy-ctl-primary.is-busy{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dfy-ctl.is-active{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dfy-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.dfy-hint{flex:0 0 auto;text-align:center;font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.7;padding-bottom:12px}
.dfy-orb{position:relative;display:grid;place-items:center;flex:0 0 auto}
.dfy-orb-halo{position:absolute;inset:-18%;border-radius:50%;background:radial-gradient(circle,var(--dsw-alias-brand-primary) 0%,transparent 68%);opacity:.2;pointer-events:none;will-change:transform,opacity}
.dfy-orb-ring{position:absolute;inset:-6%;border-radius:50%;border:1px dashed var(--dsw-alias-border-l2);opacity:0;pointer-events:none}
.dfy-orb-core{width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 32% 26%,#ffdfae 0%,#f6a666 34%,#e2714f 66%,#a8417c 100%);box-shadow:0 14px 34px rgba(224,113,79,.32),inset 0 3px 14px rgba(255,255,255,.4);will-change:transform;transform:scale(1)}
.dfy-orb[data-status="thinking"] .dfy-orb-ring{opacity:.55;border-color:var(--dsw-alias-brand-primary);border-style:solid;border-right-color:transparent;border-bottom-color:transparent;animation:dfy-spin 1.5s linear infinite}
.dfy-orb[data-status="listening"] .dfy-orb-ring{opacity:.35;border-style:solid;border-color:var(--dsw-alias-state-error-primary);border-bottom-color:transparent;border-left-color:transparent;animation:dfy-spin 3s linear infinite}
.dfy-orb[data-status="listening"] .dfy-orb-core{background:radial-gradient(circle at 32% 26%,#ffd3d9 0%,#f2708d 36%,#d43f63 68%,#8f2a63 100%)}
.dfy-gate{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:24px 26px 28px;min-height:0;overflow-y:auto}
.dfy-gate-checking{flex-direction:row;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px}
.dfy-gate-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:dfy-spin .9s linear infinite}
.dfy-gate-title{font-size:20px;font-weight:600;line-height:1.35}
.dfy-gate-text{margin:0;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-primary)}
.dfy-gate-muted{color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dfy-gate-form{display:flex;gap:8px;margin-top:6px}
.dfy-gate-input{flex:1 1 auto;min-width:0;height:44px;border-radius:999px;font-size:13px}
.dfy-gate-save{min-width:0;padding:0 18px;height:44px;white-space:nowrap}
.dfy-gate-save:disabled{opacity:.45;cursor:default}
.dfy-gate-error{margin:4px 0 0}
.dfy-gate-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:6px;flex-wrap:wrap}
.dfy-gate-link{font-size:12px;color:var(--dsw-alias-brand-text,var(--dsw-alias-label-secondary));text-decoration:underline;text-underline-offset:3px}
.dfy-settings{position:absolute;top:6px;right:12px;width:300px;max-width:calc(100% - 24px);padding:8px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 20px 46px rgba(0,0,0,.4);z-index:6}
.dfy-setting-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:9px;font-size:12.5px}
.dfy-setting-row-stack{flex-wrap:wrap}
.dfy-setting-row-stack .dfy-select,.dfy-setting-row-stack .dfy-setting-hint{flex:0 0 100%}
.dfy-setting-label{display:flex;align-items:center;gap:8px}
.dfy-setting-mini{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;text-underline-offset:2px}
.dfy-setting-mini:hover{color:var(--dsw-alias-label-primary)}
.dfy-setting-hint{color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.4}
.dfy-select{flex:1 1 auto;min-width:0;max-width:100%;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;text-overflow:ellipsis;cursor:pointer}
.dfy-seg{display:inline-flex;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px}
.dfy-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit}
.dfy-seg button[data-active="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dfy-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background .14s}
.dfy-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dfy-switch::after{content:"";display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-label-primary-foreground));transition:transform .12s ease}
.dfy-switch[aria-checked="true"]::after{transform:translate(16px)}
.dfy-switch:disabled{opacity:.5;cursor:default}
.dfy-setting-action{display:block;width:100%;text-align:left;margin-top:2px;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;font-family:inherit}
.dfy-setting-action:hover{background:var(--dsw-alias-bg-layer-2)}
@keyframes dfy-spin{to{transform:rotate(360deg)}}
@keyframes dfy-pulse{0%,100%{box-shadow:0 0 0 5px color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent)}50%{box-shadow:0 0 0 11px color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}}
@keyframes dfy-breathe{0%,100%{opacity:.16;transform:scale(.94)}50%{opacity:.4;transform:scale(1.04)}}
@keyframes dfy-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@media (max-width:520px){.dfy-panel{border-radius:20px}.dfy-picker-title{font-size:20px}.dfy-voices{flex-direction:column}.dfy-voice{flex-direction:row;justify-content:flex-start;gap:12px;padding:12px}.dfy-voice-avatar{width:52px;height:52px;font-size:16px}.dfy-voice-meta{text-align:left}.dfy-controls{gap:14px}}
`

    /* ------------------------------------------------------------------ *
     * Registration
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let translate
        try {
          ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh), 'dafeiyu: zh dictionary')
          ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en), 'dafeiyu: en dictionary')
          translate = ctx.locale.bind(NS)
        } catch (error) {
          console.error('dafeiyu: locale setup failed', error)
        }

        const t = (key) => {
          try {
            if (translate !== undefined) {
              const value = translate(key)
              if (typeof value === 'string' && value.length > 0 && value !== key) return value
            }
          } catch {
            /* fall through to the built-in dictionary */
          }
          return DICT.zh[key] ?? DICT.en[key] ?? key
        }

        const saveKey = async (rawKey) => {
          const key = String(rawKey ?? '').trim()
          if (!/^sk-[A-Za-z0-9_-]{10,}$/u.test(key)) throw new Error(t('keyBadFormat'))
          try {
            const response = await fetch(KEY_ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key }),
            })
            if (response.ok) return
            if (response.status === 404 || response.status === 405) {
              // A Host half from an older build has no key route: the address
              // reaches the static fallback, which answers 405 for a POST (404
              // when nothing matches). The shared credentials remote still
              // stores the same reference, so the panel works before a restart.
              let remote
              try {
                remote = (typeof ctx.get === 'function' ? ctx.get('remote') : undefined) ?? ctx.remote
              } catch {
                remote = undefined
              }
              const credentials = remote !== null && typeof remote === 'object' ? remote.credentials : undefined
              if (credentials === undefined || typeof credentials.set !== 'function') {
                throw new Error(t('keyNeedsRestart'))
              }
              const result = await credentials.set(CREDENTIAL, key)
              if (result === null || typeof result !== 'object' || result.ok !== true) {
                throw new Error(result?.error?.message ?? t('keySaveFailed'))
              }
              return
            }
            const detail = await response.json().catch(() => null)
            throw apiError(detail, t('keySaveFailed'))
          } catch (error) {
            if (error instanceof TypeError) throw new Error(t('keySaveFailed'))
            if (error instanceof Error && error.message.length > 0) throw error
            throw new Error(t('keySaveFailed'))
          }
        }

        function Entrance() {
          const [, force] = React.useReducer((value) => value + 1, 0)
          useEffect(() => ctx.locale.subscribe(() => force()), [])
          return h(React.Fragment, null, h('style', null, STYLES), h(Panel, { t, saveKey }))
        }

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dafeiyu-voice-chat', order: 20, label: t('title') }, Entrance),
        )
      },
    }
  },
})
