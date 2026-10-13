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
