/**
 * Reading the measured mount points off a record.
 *
 * Three functions, and every one of them exists because the alternative is the
 * same few lines written slightly differently in the builder, the assembly
 * resolver and the detail drawer. {@link copiesOf} is the one where "slightly
 * differently" would be a silent disagreement rather than a duplicate: it is
 * read by the renderer and by the bill, and they must count the same copies.
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
import type { CatalogRecord, Face, InsertAnchor, Mount, Vec3 } from './schema'

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

/**
 * How many copies of one insert a mount takes: **two half-leaves, or one of
 * anything else.**
 *
 * The one place that decides, and three consumers read it — `buildRoom3D` to
 * know how many instances to add, `place.ts#accessoryMatrix` to know whether to
 * offset and turn them, and `assembly/resolve.ts` to price the bill. If any two
 * of those answered separately they could disagree, and the ways they would
 * disagree are both invisible: a second leaf drawn at the first leaf's seat is
 * two coplanar slabs z-fighting rather than a visible error, and a bill one leaf
 * short is a download that cannot fill the doorway it came with.
 *
 * It lives here, next to {@link mountsFor}, because `@/assembly` must not import
 * from `@/builder` — the dependency runs the other way — and both need this
 * answer. It is a fact about a mount and an anchor, which is what this module
 * is for.
 *
 * ## `leaves: 2` is a property of the doorway, not of what goes in it
 *
 * `OpeningMount.leaves` is 2 when the host's `require` carries `size|wide` or
 * `size|double` — 85 `door` mounts, 47 `lintel` and 15 `portcullis` over the
 * measured corpus — and it says *the doorway is authored for two leaves*. That
 * is not the same claim as *this insert is one of them*: the same wide doorway
 * takes **one** `door_lintel.double.1.stl` (a 60.85 mm slab over a 47.5 mm
 * opening) and **two** 24.6 mm door leaves. Both are `leaf`-kind anchors, so the
 * kind alone cannot separate them, and drawing every leaf twice put a 60.9 mm
 * lintel at ±11.9 mm on 47 openings and a one-piece portcullis on 15.
 *
 * The measurement that does separate them is the **span** — the longer of the
 * two horizontal bbox extents, an insert being authored Z-up. A genuine
 * half-leaf is about half its opening (24.6 in 47.5, 52 %); a one-piece lintel or
 * portcullis over-spans it (60.85 in 47.5, 128 %; 55.8 in 51, 109 %). The 0.8
 * threshold sits in the empty middle of that gap, nearer the pieces it must not
 * split.
 *
 * **A face with no horizontal direction is not a pair.** The two seats are
 * `±width/4` along `up × normal`, so an opening whose measured normal is
 * vertical — degenerate data, not a doorway — has nowhere to put the second one.
 * One copy is the honest answer there; two at one seat is not.
 */
export function copiesOf(mount: Mount, anchor: InsertAnchor | undefined): 1 | 2 {
  if (mount.kind !== 'opening' || mount.leaves !== 2) return 1
  if (anchor === undefined || anchor.kind !== 'leaf') return 1
  if (!hasHorizontalNormal(mount.normal)) return 1
  const span = Math.max(anchor.size[0], anchor.size[1])
  return span < HALF_LEAF_SPAN_FRACTION * mount.width ? 2 : 1
}

/**
 * The share of its opening a leaf may span and still be half of a pair.
 *
 * Measured: half-leaves run 52 % of their opening, and the one-piece slabs that
 * share the `leaves: 2` flag run 109–128 %. See {@link copiesOf}.
 */
const HALF_LEAF_SPAN_FRACTION = 0.8

/**
 * Whether a normal has a horizontal component to lay two seats along.
 *
 * The same `1e-12` floor `place.ts` states: under a squared length of that, a
 * measurement is not a direction, and `up × normal` is a zero vector rather than
 * a short one.
 */
function hasHorizontalNormal(normal: Vec3): boolean {
  return normal[0] * normal[0] + normal[1] * normal[1] > 1e-12
}
