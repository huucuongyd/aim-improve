import './style.css'

const CIRCLE_SIZE = 64
const MOVE_INTERVAL_MS = 1000
const ROUND_SECONDS = 60
const BEST_KEY = 'circle-clicker-best'
const SETTINGS_KEY = 'circle-clicker-valorant-settings'

/** Valorant: degrees turned per mouse count at sens 1 */
const VALORANT_YAW = 0.07
/** Valorant default 16:9 hipfire horizontal FOV (degrees) */
const VALORANT_HFOV = 103

const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {}

const app = document.querySelector('#app')

app.innerHTML = `
  <header class="hud">
    <div class="hud-stats">
      <div class="stat">Score: <span id="score">0</span></div>
      <div class="stat">Best: <span id="best">0</span></div>
      <div class="stat">Time: <span id="time">${ROUND_SECONDS}</span>s</div>
      <div class="stat">eDPI: <span id="edpi">120</span></div>
    </div>
    <div class="hud-controls">
      <label class="field">
        Sens
        <input id="sens-input" type="number" min="0.01" max="10" step="0.01" value="${saved.sens ?? 0.3}" />
      </label>
      <label class="field">
        DPI
        <input id="dpi-input" type="number" min="100" max="20000" step="50" value="${saved.dpi ?? 400}" />
      </label>
      <div class="modes" role="group" aria-label="Game mode">
        <button type="button" class="mode-btn is-active" data-mode="auto">Auto</button>
        <button type="button" class="mode-btn" data-mode="click">Click</button>
      </div>
      <button type="button" class="action-btn" id="start-btn">Start</button>
      <button type="button" class="action-btn action-stop" id="stop-btn" disabled>Stop</button>
    </div>
  </header>
  <p class="hint">
    Valorant feel: set mouse hardware to your DPI, enter the same sens (0.3 @ 400 DPI).
    Start locks the pointer — aim with the plus, click to hit. Esc unlocks.
  </p>
  <button class="circle is-hidden" id="circle" type="button" aria-label="Target" hidden></button>
  <div class="overlay is-visible" id="overlay">
    <p id="overlay-text">Set sens/DPI like Valorant, then press Start</p>
  </div>
  <div class="cursor" id="cursor" aria-hidden="true"></div>
`

const scoreEl = document.querySelector('#score')
const bestEl = document.querySelector('#best')
const timeEl = document.querySelector('#time')
const edpiEl = document.querySelector('#edpi')
const circleEl = document.querySelector('#circle')
const cursorEl = document.querySelector('#cursor')
const startBtn = document.querySelector('#start-btn')
const stopBtn = document.querySelector('#stop-btn')
const overlayEl = document.querySelector('#overlay')
const overlayTextEl = document.querySelector('#overlay-text')
const modeBtns = document.querySelectorAll('.mode-btn')
const sensInput = document.querySelector('#sens-input')
const dpiInput = document.querySelector('#dpi-input')

let mode = 'auto'
let score = 0
let best = Number(localStorage.getItem(BEST_KEY)) || 0
let playing = false
let timeLeft = ROUND_SECONDS
let moveTimer = null
let countdownTimer = null
let cursorX = window.innerWidth / 2
let cursorY = window.innerHeight / 2

bestEl.textContent = String(best)

function getSens() {
  return Math.max(0.01, Number(sensInput.value) || 0.3)
}

function getDpi() {
  return Math.max(100, Number(dpiInput.value) || 400)
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ sens: getSens(), dpi: getDpi() }),
  )
  updateEdpi()
}

function updateEdpi() {
  edpiEl.textContent = String(Math.round(getSens() * getDpi() * 100) / 100)
}

/** Map Valorant mouse counts → screen pixels (same yaw as in-game). */
function valorantPixelsPerCount() {
  return getSens() * VALORANT_YAW * (window.innerWidth / VALORANT_HFOV)
}

function updateCursorEl() {
  cursorEl.style.transform = `translate(${cursorX}px, ${cursorY}px) translate(-50%, -50%)`
}

function clampCursor() {
  cursorX = Math.min(window.innerWidth, Math.max(0, cursorX))
  cursorY = Math.min(window.innerHeight, Math.max(0, cursorY))
}

function placeCircle() {
  const maxX = Math.max(0, window.innerWidth - CIRCLE_SIZE)
  const maxY = Math.max(0, window.innerHeight - CIRCLE_SIZE)
  const x = Math.random() * maxX + CIRCLE_SIZE / 2
  const y = Math.random() * maxY + CIRCLE_SIZE / 2

  circleEl.style.left = `${x}px`
  circleEl.style.top = `${y}px`
}

function circleCenter() {
  return {
    x: parseFloat(circleEl.style.left) || 0,
    y: parseFloat(circleEl.style.top) || 0,
  }
}

function isCursorOnCircle() {
  const { x, y } = circleCenter()
  const dx = cursorX - x
  const dy = cursorY - y
  const radius = CIRCLE_SIZE / 2
  return dx * dx + dy * dy <= radius * radius
}

function clearTimers() {
  clearInterval(moveTimer)
  clearInterval(countdownTimer)
  moveTimer = null
  countdownTimer = null
}

function saveBest() {
  if (score > best) {
    best = score
    localStorage.setItem(BEST_KEY, String(best))
    bestEl.textContent = String(best)
  }
}

function showOverlay(message) {
  overlayTextEl.textContent = message
  overlayEl.classList.add('is-visible')
}

function hideOverlay() {
  overlayEl.classList.remove('is-visible')
}

function setPlayingUi(isPlaying) {
  playing = isPlaying
  startBtn.disabled = isPlaying
  stopBtn.disabled = !isPlaying
  modeBtns.forEach((btn) => {
    btn.disabled = isPlaying
  })
  sensInput.disabled = isPlaying
  dpiInput.disabled = isPlaying

  if (isPlaying) {
    circleEl.hidden = false
    circleEl.classList.remove('is-hidden')
  } else {
    circleEl.hidden = true
    circleEl.classList.add('is-hidden')
  }
}

function releasePointer() {
  if (document.pointerLockElement) {
    document.exitPointerLock()
  }
}

function endRound(reason) {
  if (!playing) return

  clearTimers()
  saveBest()
  setPlayingUi(false)
  releasePointer()

  const message =
    reason === 'time'
      ? `Time's up! Score: ${score} · Best: ${best}`
      : reason === 'unlock'
        ? `Pointer unlocked. Score: ${score} · Best: ${best}`
        : `Stopped. Score: ${score} · Best: ${best}`

  showOverlay(message)
}

function registerHit() {
  if (!playing || !isCursorOnCircle()) return

  score += 1
  scoreEl.textContent = String(score)
  placeCircle()

  if (mode === 'auto') {
    clearInterval(moveTimer)
    moveTimer = setInterval(placeCircle, MOVE_INTERVAL_MS)
  }
}

async function startRound() {
  saveSettings()
  clearTimers()
  score = 0
  timeLeft = ROUND_SECONDS
  scoreEl.textContent = '0'
  timeEl.textContent = String(timeLeft)
  cursorX = window.innerWidth / 2
  cursorY = window.innerHeight / 2
  updateCursorEl()
  hideOverlay()
  setPlayingUi(true)
  placeCircle()

  try {
    await app.requestPointerLock({ unadjustedMovement: true })
  } catch {
    try {
      await app.requestPointerLock()
    } catch {
      showOverlay('Pointer lock blocked — allow it, then press Start again')
      setPlayingUi(false)
      return
    }
  }

  countdownTimer = setInterval(() => {
    timeLeft -= 1
    timeEl.textContent = String(timeLeft)
    if (timeLeft <= 0) {
      endRound('time')
    }
  }, 1000)

  if (mode === 'auto') {
    moveTimer = setInterval(placeCircle, MOVE_INTERVAL_MS)
  }
}

function setMode(nextMode) {
  if (playing) return
  mode = nextMode
  modeBtns.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === mode)
  })
}

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode))
})

startBtn.addEventListener('click', () => {
  startRound()
})
stopBtn.addEventListener('click', () => endRound('stop'))

sensInput.addEventListener('change', saveSettings)
dpiInput.addEventListener('change', saveSettings)
sensInput.addEventListener('input', updateEdpi)
dpiInput.addEventListener('input', updateEdpi)

document.addEventListener('pointerlockchange', () => {
  if (playing && !document.pointerLockElement) {
    endRound('unlock')
  }
})

document.addEventListener('mousemove', (event) => {
  if (playing && document.pointerLockElement) {
    const scale = valorantPixelsPerCount()
    cursorX += event.movementX * scale
    cursorY += event.movementY * scale
    clampCursor()
    updateCursorEl()
    return
  }

  cursorX = event.clientX
  cursorY = event.clientY
  updateCursorEl()
})

document.addEventListener('click', () => {
  if (!playing || !document.pointerLockElement) return
  registerHit()
})

circleEl.addEventListener('click', (event) => {
  // Fallback if pointer lock is unavailable
  if (document.pointerLockElement) return
  event.stopPropagation()
  if (!playing) return
  score += 1
  scoreEl.textContent = String(score)
  placeCircle()
  if (mode === 'auto') {
    clearInterval(moveTimer)
    moveTimer = setInterval(placeCircle, MOVE_INTERVAL_MS)
  }
})

window.addEventListener('resize', () => {
  clampCursor()
  updateCursorEl()
  if (playing) placeCircle()
})

updateEdpi()
updateCursorEl()
