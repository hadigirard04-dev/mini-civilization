/** 地图像素基准尺寸（未缩放时每格 16px） */
export const TILE = 16

export interface Camera {
  /** 视口中心对应的世界坐标（格为单位） */
  x: number
  y: number
  zoom: number
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** 世界坐标（格）→ 屏幕坐标（CSS px） */
export function worldToScreen(cam: Camera, viewW: number, viewH: number, wx: number, wy: number) {
  const sps = TILE * cam.zoom
  return { x: (wx - cam.x) * sps + viewW / 2, y: (wy - cam.y) * sps + viewH / 2 }
}

/** 屏幕坐标（CSS px）→ 世界坐标（格） */
export function screenToWorld(cam: Camera, viewW: number, viewH: number, sx: number, sy: number) {
  const sps = TILE * cam.zoom
  return { x: cam.x + (sx - viewW / 2) / sps, y: cam.y + (sy - viewH / 2) / sps }
}

/** 将相机限制在世界范围内（世界小于视口时居中） */
export function clampCamera(cam: Camera, worldSize: number, viewW: number, viewH: number): void {
  cam.zoom = clamp(cam.zoom, 0.06, 6)
  const sps = TILE * cam.zoom
  const halfW = viewW / 2 / sps
  const halfH = viewH / 2 / sps
  cam.x = halfW * 2 >= worldSize ? worldSize / 2 : clamp(cam.x, halfW, worldSize - halfW)
  cam.y = halfH * 2 >= worldSize ? worldSize / 2 : clamp(cam.y, halfH, worldSize - halfH)
}

/** 为城市场景留出天际线和顶部信息条空间；镜头根据城区范围而非整片大陆取景。 */
export function frameSettlement(points: Array<{ x: number; y: number }>, worldSize: number,
  viewW: number, viewH: number, era = 0): Camera {
  const center = worldSize / 2
  const minX = Math.min(...points.map((p) => p.x), center) - 3
  const maxX = Math.max(...points.map((p) => p.x), center) + 4
  const minY = Math.min(...points.map((p) => p.y), center) - (era >= 4 ? 8 : era >= 2 ? 5 : 3)
  const maxY = Math.max(...points.map((p) => p.y), center) + 3
  const zoom = Math.max(0.06, Math.min((viewW - 28) / (TILE * Math.max(12, maxX - minX)),
    Math.max(100, viewH - 60) / (TILE * Math.max(10, maxY - minY)), 2.6))
  const camera = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 - 12 / (zoom * TILE), zoom }
  clampCamera(camera, worldSize, viewW, viewH)
  return camera
}
