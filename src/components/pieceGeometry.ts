type IsOccupied = (x: number, y: number) => boolean

export type JoinedCellBounds = {
  left: number
  right: number
  top: number
  bottom: number
}

export function getJoinedCellBounds(
  x: number,
  y: number,
  isOccupied: IsOccupied,
  inset = 0.055,
): JoinedCellBounds {
  const overlap = 0.004
  return {
    left: x + (isOccupied(x - 1, y) ? -overlap : inset),
    right: x + (isOccupied(x + 1, y) ? 1 + overlap : 1 - inset),
    top: y + (isOccupied(x, y - 1) ? -overlap : inset),
    bottom: y + (isOccupied(x, y + 1) ? 1 + overlap : 1 - inset),
  }
}

export function getOrthogonalJoinClasses(
  prefix: string,
  x: number,
  y: number,
  isOccupied: IsOccupied,
): string[] {
  return [
    isOccupied(x - 1, y) ? `${prefix}--join-left` : '',
    isOccupied(x + 1, y) ? `${prefix}--join-right` : '',
    isOccupied(x, y - 1) ? `${prefix}--join-up` : '',
    isOccupied(x, y + 1) ? `${prefix}--join-down` : '',
  ].filter(Boolean)
}
