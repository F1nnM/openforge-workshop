/**
 * Reading the measured mount points off a record.
 *
 * Two functions, and both exist because the alternative is the same three lines
 * written slightly differently in the builder, the assembly resolver and the
 * detail drawer.
 *
 * ## The frame, in one place
 *
 * Everything a mount carries is in the host's bounding box — x and y from the
 * centre, z from the floor, Z-up, millimetres — and `Vec3`'s docblock in
 * `./schema` is the contract. {@link faceVector} is the other half of it: the
 * outward normal of the face a mount opens through, so a consumer never has to
 * decide for itself whether `-y` means "the near side" or "pointing at the
 * viewer". It points **out of the host**, which makes an accessory's own axis
 * the negation of it and makes `dot(mount.axis, faceVector(mount.face))` the
 * cosine of a socket's tilt — cos 65° for the measured torch socket, and −cos
 * 65° for anybody who got the sign convention backwards.
 *
 * ## Orient by `mount.normal`, not by this
 *
 * That identity is a *flat* host's. A sector is measured in the unrolled frame,
 * where `face` names the inner or the outer radius, so `faceVector(face)` there
 * is a chord normal: the same torch sockets read 59.7–65.5° from it on flat
 * hosts and 62–81° on arcs. `Mount.normal` carries the re-rolled surface normal
 * for exactly that reason, it equals `faceVector(face)` wherever the host is
 * flat, and it is what a renderer must align an insert to. This function stays
 * for the six axis-aligned constants themselves — a footprint's own facing, a
 * hole read from above — not as a substitute for the measured field.
 *
 * ## Absence folds to empty, once
 *
 * `record.mounts` is absent both when the tile has no accessory slot and when
 * nobody has measured its mesh — see {@link CatalogRecord.mounts} for why the
 * schema does not distinguish them — and every caller wants a list either way.
 */
import type { CatalogRecord, Face, Mount, Vec3 } from './schema'

/**
 * The outward unit normal of a face, Z-up, in the host's own frame.
 *
 * Frozen and shared rather than allocated per call: this runs inside the
 * builder's placement loop, the six values never differ, and a caller that
 * wants a mutable copy spreads it.
 */
const FACE_VECTORS: Readonly<Record<Face, Vec3>> = {
  '-x': Object.freeze([-1, 0, 0]),
  '+x': Object.freeze([1, 0, 0]),
  '-y': Object.freeze([0, -1, 0]),
  '+y': Object.freeze([0, 1, 0]),
  '-z': Object.freeze([0, 0, -1]),
  '+z': Object.freeze([0, 0, 1]),
}

/** The unit normal pointing **out of** the host through `face`. See the module note. */
export function faceVector(face: Face): Vec3 {
  return FACE_VECTORS[face]
}

/**
 * Every measured mount for one composition slot, in measurement order.
 *
 * Empty for an unmeasured record and for a slot with no mount, which are the
 * same thing to a caller placing an accessory: there is nowhere to put it.
 *
 * Order is the host's — `classify.ts` returns a face's poses left to right —
 * and it matters: a 4-unit s_system wall carries two torch sockets at x = ±25.2
 * and a `wide` doorway two leaves, so "the first one" has to mean the same thing
 * on every render.
 */
export function mountsFor(record: CatalogRecord, slot: string): readonly Mount[] {
  return (record.mounts ?? []).filter((mount) => mount.slot === slot)
}
