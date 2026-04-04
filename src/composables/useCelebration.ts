import { ref, onUnmounted } from 'vue'

// Particle shape types
type ParticleShape = 'circle' | 'rectangle' | 'triangle'

// Particle interface
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  rotationSpeed: number
  shape: ParticleShape
  color: string
  width: number
  height: number
  alpha: number
  decay: number
}

// Vibrant celebration color palette
const CELEBRATION_COLORS = [
  '#FF6B6B', // coral red
  '#4ECDC4', // teal
  '#FFE66D', // sunny yellow
  '#95E1D3', // mint
  '#F38181', // salmon
  '#AA96DA', // lavender
  '#FCBAD3', // pink
  '#A8D8EA', // sky blue
  '#FF9F1C', // orange
  '#2EC4B6', // turquoise
  '#E71D36', // crimson
  '#7209B7', // purple
]

// Shape generators
function createCircle(ctx: CanvasRenderingContext2D, particle: Particle): void {
  ctx.beginPath()
  ctx.arc(0, 0, particle.width / 2, 0, Math.PI * 2)
  ctx.fill()
}

function createRectangle(ctx: CanvasRenderingContext2D, particle: Particle): void {
  ctx.fillRect(
    -particle.width / 2,
    -particle.height / 2,
    particle.width,
    particle.height
  )
}

function createTriangle(ctx: CanvasRenderingContext2D, particle: Particle): void {
  ctx.beginPath()
  ctx.moveTo(0, -particle.height / 2)
  ctx.lineTo(particle.width / 2, particle.height / 2)
  ctx.lineTo(-particle.width / 2, particle.height / 2)
  ctx.closePath()
  ctx.fill()
}

const shapeDrawers: Record<ParticleShape, (ctx: CanvasRenderingContext2D, particle: Particle) => void> = {
  circle: createCircle,
  rectangle: createRectangle,
  triangle: createTriangle,
}

// Physics constants
const GRAVITY = 0.15
const WIND = 0.02
const FRICTION = 0.99
const MIN_VELOCITY = 2
const MAX_VELOCITY = 8
const PARTICLE_COUNT = 150
const DEFAULT_DURATION = 3000

export function useCelebration() {
  const celebrationCanvas = ref<HTMLCanvasElement | null>(null)
  let animationFrameId: number | null = null
  let particles: Particle[] = []
  let isAnimating = false
  let canvasWidth = 0
  let canvasHeight = 0
  let burstTimer: ReturnType<typeof setInterval> | null = null
  let currentBurstTimer: ReturnType<typeof setInterval> | null = null

  function randomRange(min: number, max: number): number {
    return Math.random() * (max - min) + min
  }

  function randomColor(): string {
    return CELEBRATION_COLORS[Math.floor(Math.random() * CELEBRATION_COLORS.length)]
  }

  function randomShape(): ParticleShape {
    const shapes: ParticleShape[] = ['circle', 'rectangle', 'triangle']
    return shapes[Math.floor(Math.random() * shapes.length)]
  }

  function createParticle(originX: number, originY: number): Particle {
    const angle = randomRange(0, Math.PI * 2)
    const velocity = randomRange(MIN_VELOCITY, MAX_VELOCITY)
    const size = randomRange(6, 14)

    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - randomRange(2, 5), // Initial upward boost
      rotation: randomRange(0, Math.PI * 2),
      rotationSpeed: randomRange(-0.2, 0.2),
      shape: randomShape(),
      color: randomColor(),
      width: size,
      height: size,
      alpha: 1,
      decay: randomRange(0.003, 0.008),
    }
  }

  function generateParticles(originX: number, originY: number, count: number): Particle[] {
    const newParticles: Particle[] = []
    for (let i = 0; i < count; i++) {
      newParticles.push(createParticle(originX, originY))
    }
    return newParticles
  }

  function updateParticle(particle: Particle): boolean {
    // Apply physics
    particle.vy += GRAVITY
    particle.vx += (Math.random() - 0.5) * WIND
    particle.vx *= FRICTION
    particle.vy *= FRICTION

    particle.x += particle.vx
    particle.y += particle.vy
    particle.rotation += particle.rotationSpeed

    // Fade out
    particle.alpha -= particle.decay

    // Check if particle is still visible
    return particle.alpha > 0 && particle.y < canvasHeight + 50
  }

  function renderParticle(ctx: CanvasRenderingContext2D, particle: Particle): void {
    ctx.save()
    ctx.translate(particle.x, particle.y)
    ctx.rotate(particle.rotation)
    ctx.globalAlpha = particle.alpha
    ctx.fillStyle = particle.color

    const drawer = shapeDrawers[particle.shape]
    drawer(ctx, particle)

    ctx.restore()
  }

  function animate(canvas: HTMLCanvasElement): void {
    if (!isAnimating) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas with transparency
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)

    // Update and filter particles
    particles = particles.filter(updateParticle)

    // Render particles
    for (const particle of particles) {
      renderParticle(ctx, particle)
    }

    // Continue animation if particles remain
    if (particles.length > 0) {
      animationFrameId = requestAnimationFrame(() => animate(canvas))
    } else {
      stopAnimation()
    }
  }

  function stopAnimation(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    if (burstTimer !== null) {
      clearInterval(burstTimer)
      burstTimer = null
    }
    if (currentBurstTimer !== null) {
      clearInterval(currentBurstTimer)
      currentBurstTimer = null
    }
    isAnimating = false

    // Clear canvas
    const canvas = celebrationCanvas.value
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight)
      }
    }
    particles = []
  }

  function getCanvasDimensions(): { width: number; height: number } {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    }
  }

  function resizeCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    canvasWidth = canvas.width
    canvasHeight = canvas.height
  }

  function celebrate(position?: { x: number; y: number }, duration: number = DEFAULT_DURATION): void {
    const canvas = celebrationCanvas.value
    if (!canvas) return

    // Stop any existing animation
    if (isAnimating) {
      stopAnimation()
    }

    // Setup canvas
    resizeCanvas(canvas)
    isAnimating = true

    // Determine origin position
    const originX = position?.x ?? canvasWidth / 2
    const originY = position?.y ?? canvasHeight / 2

    // Generate initial burst of particles
    particles = generateParticles(originX, originY, PARTICLE_COUNT)

    // Add secondary bursts over time for sustained celebration
    const burstInterval = duration / 4
    let burstCount = 0
    currentBurstTimer = setInterval(() => {
      if (burstCount < 3 && isAnimating) {
        particles.push(...generateParticles(originX, originY, Math.floor(PARTICLE_COUNT / 2)))
        burstCount++
      } else if (currentBurstTimer) {
        clearInterval(currentBurstTimer)
        currentBurstTimer = null
      }
    }, burstInterval)

    // Start animation
    animate(canvas)

    // Auto-cleanup after duration
    setTimeout(() => {
      stopAnimation()
    }, duration)
  }

  // Cleanup on unmount
  onUnmounted(() => {
    stopAnimation()
  })

  return {
    celebrate,
    celebrationCanvas,
  }
}
