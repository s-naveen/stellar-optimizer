/** Intersection of two disks, including disjoint and contained disks. */
export function diskIntersection(a: number, b: number, distance: number) {
  if (distance >= a + b) return 0
  if (distance <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2
  const angle = (r: number, other: number) =>
    Math.acos((distance ** 2 + r ** 2 - other ** 2) / (2 * distance * r))
  const area = a ** 2 * angle(a, b) + b ** 2 * angle(b, a)
  return (
    area -
    0.5 *
      Math.sqrt(
        (-distance + a + b) *
          (distance + a - b) *
          (distance - a + b) *
          (distance + a + b)
      )
  )
}

/** Native CalcRandomPointFromCenter samples uniformly in an annulus. */
export function annulusHitChance(
  inner: number,
  outer: number,
  hitRadius: number,
  distance: number
) {
  return (
    (diskIntersection(outer, hitRadius, distance) -
      diskIntersection(inner, hitRadius, distance)) /
    (Math.PI * (outer ** 2 - inner ** 2))
  )
}
