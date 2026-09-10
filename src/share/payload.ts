/**
 * The columnar wire format: a header, three string tables, then one column per field.
 *
 * This module is deliberately ignorant of the catalog, the manifest and the
 * store. It maps a {@link WirePayload} — small numbers and opaque strings — to
 * bytes and back, synchronously. Everything that needs to know what a number
 * *means* lives in `link.ts`, which is also where the compression and the base64
 * live. Keeping the split means the format can be exercised exhaustively in a
 * plain node test with no streams involved.
 *
 * ## Why columnar
 *
 * Placements share structure: a room is one template repeated ninety times, one
 * wall family repeated forty, two rotations, and the same three or five files in
 * every instance's slots. Row-major layout interleaves those repetitions with the
 * coordinates, which are the only part that actually varies, so deflate's
 * back-references have to straddle changing bytes. Column-major puts all ninety
 * copies of the floor ordinal next to each other and all ninety coordinates next
 * to each other, and the match lengths go from ~4 bytes to hundreds.
 *
 * **Row A1 made that argument stronger rather than weaker.** An instance is a
 * template plus a fill per slot, so a room-shaped build now repeats *three to
 * five* ordinals per placement instead of one, and every one of those columns is
 * a run of identical bytes.
 *
 * Measured by `capacity.test.ts`, which prints this table on every run —
 * template instances that fit inside a 2,000-character URL. **Every figure is
 * format 6's and none of the pre-A1 ones carry over**: a placement was one
 * ordinal on a cell, so the old numbers are about a different subject rather than
 * a tuned version of this one, and none of them is restated here.
 *
 * | layout                      | room-shaped build | scattered build |
 * | --------------------------- | ----------------: | --------------: |
 * | naive JSON array of objects |               261 |              45 |
 * | columnar JSON               |             3,897 |              70 |
 * | row-major varint            |               520 |              56 |
 * | ids inline, no tables       |             1,670 |              80 |
 * | pinned as a byte per fill   |             6,283 |              77 |
 * | **columnar varint (this)**  |         **6,683** |          **80** |
 *
 * The middle rows are there to separate the effects, because they are not the
 * same size. **Layout** is what carries the room build: columnar JSON reaches
 * 3,897 against naive JSON's 261, a 14.9x gain from nothing but reordering the
 * same characters. **Representation** is what carries the scattered build: it is
 * essentially incompressible — `deflate-raw` returns *more* bytes than it was
 * given below about a hundred placements — so no layout helps, and the varint
 * packing lifts it from 45 to 56. Columnar varint takes both, and is the only one
 * of the six that is last on neither shape.
 *
 * The two JSON rows carry **no hold column at all**, which flatters them by
 * roughly what the shipped row pays for one; they are still an order of magnitude
 * behind on the room shape, so the comparison survives the asymmetry rather than
 * depending on it.
 *
 * The spread between the two shapes is 80 to 6,683, a factor of 84, which is why
 * `link.ts` gates on the measured URL rather than on a count: any instance-count
 * threshold is wrong by nearly two orders of magnitude at one end or the other.
 *
 * **What format 6 cost the shape people build**: 6,956 instances to **6,683**
 * (−3.9%) on the room build and 81 to **80** on the scattered one, re-measured
 * rather than adjusted, on fixtures that fill **no holds at all** — so that is
 * the price of the zero hold count per fill, paid by every room that never fits
 * an accessory. A byte per fill is what a column has to cost to be re-splittable
 * at all, and the alternative — a flag bit saying *this payload has no holds* —
 * buys 3.9% of the loose end and nothing of the tight one, for a second way to
 * read the same bytes.
 *
 * **What the filters cost, measured under format 5 and unchanged by 6, since it
 * is a comparison of two variants at one format**: 7,358 to 6,956 on the room
 * shape (−5.5%) and 88 to 81 on the scattered one (−8.0%). The room pays almost
 * nothing per instance — its whole build is one filter position, so the column
 * is a run of one repeated index and the table holds a single 47-byte entry —
 * and the scattered shape pays a table entry per instance, which is the shape
 * where no table has ever helped (see below). Both are the price of a
 * distinction that is **not recoverable from the fills**, so the alternative is
 * not a smaller link but a link that opens a different room.
 *
 * Delta-coding the columns was measured during design and **rejected**: it gains
 * on the room build, which is already past any URL length that matters, and costs
 * on the scattered build, which is the one that is actually tight. The delta
 * between two unrelated ordinals is usually wider than either ordinal.
 *
 * ## Layout
 *
 * ```text
 *   u8      format version          SHARE_FORMAT_VERSION
 *   u8      flags                   bits 0-2 instance x/z/rotation exact,
 *                                   bits 3-5 generated x/z/rotation exact
 *   uvar    manifest version        CatalogFile.version.manifest
 *   u8      lock index              index into LOCK_ORDER
 *   uvar    count                   number of template instances
 *   u8[4]   digest                  see manifest.ts, big-endian
 *   uvar    template table count    distinct TemplateIds in the scene
 *   template table                  count x (uvar byte length, UTF-8 bytes)
 *   uvar    slot table count        distinct slot names in the scene
 *   slot table                      count x (uvar byte length, UTF-8 bytes)
 *   uvar    filter table count      distinct filter *sets* in the scene
 *   filter table                    count x (uvar byte length, UTF-8 bytes)
 *   template column                 count x uvar (index into the template table)
 *   filter column                   count x uvar (index into the filter table)
 *   x column                        count x zigzag(x * 2)   or   count x f64
 *   z column                        count x zigzag(z * 2)   or   count x f64
 *   rotation column                 count x uvar(rot * 4)   or   count x f64
 *   fill count column               count x uvar (filled slots on that instance)
 *   slot column                     fills x uvar (index into the slot table)
 *   ordinal column                  fills x uvar (the fill's own file ordinal)
 *   pinned bitset                   ceil(fills / 8) bytes, LSB first
 *   hold count column               fills x uvar (holds fitted into that fill)
 *   hold slot column                holds x uvar (index into the slot table)
 *   hold ordinal column             holds x uvar (the hold's own file ordinal)
 *   hold pinned bitset              ceil(holds / 8) bytes, LSB first
 *   uvar    recipe count            distinct generated bases in the scene
 *   recipe table                    recipeCount x (uvar byte length, UTF-8 bytes)
 *   uvar    generated count         generated placements on the scene
 *   recipe column                   genCount x uvar (index into the recipe table)
 *   generated x column              genCount x zigzag(x * 2)   or   genCount x f64
 *   generated z column              genCount x zigzag(z * 2)   or   genCount x f64
 *   generated rotation column       genCount x uvar(rot * 4)   or   genCount x f64
 * ```
 *
 * `fills` above is the sum of the fill count column — the payload's total number
 * of filled slots — and `holds` is the sum of the hold count column. The three
 * fill columns are **flat**, instance-major: an instance's fills are the next
 * `fills[i]` entries of each. That is the columnar choice applied one level down,
 * and the alternative — a length-prefixed run per instance, interleaved — is the
 * row-major layout the table above measures.
 *
 * ## Holds are that same argument a second time
 *
 * A hold is a fill of the *file a slot is filled with* — a torch in the wall's
 * socket — so it is the same three fields behind the same kind of count column,
 * and the count column is per **fill** rather than per instance. The four hold
 * columns sit after the pinned bitset, so everything before them is byte
 * identical to format 5.
 *
 * **A hold costs two uvars and a bit**, which is 2 bytes and change at the
 * ordinals the corpus reaches, and it interns its name into the **same table as
 * the slot names**: a hold name is a word or two with no manifest ordinal, which
 * is the slot table's entire argument arriving one level down, and a room where
 * ninety walls carry a `torch` pays for the string once. A separate hold-name
 * table would double the table overhead of the format to keep two populations
 * apart that the decoder tells apart by *position* anyway.
 *
 * What a hold-free payload pays is **one byte per fill** — its zero hold count —
 * and nothing else: measured, a one-fill payload goes from 224 bytes to 225, and
 * an empty scene stays at 14, because the column is per fill rather than a fourth
 * empty column of its own. A fill that does carry two holds pays 5 bytes for them
 * (two slot bytes, two ordinal bytes, and the byte the bitset opens with).
 *
 * The nesting stops here, by the same construction the store uses
 * (`store/schema.ts#HoldFill`): a {@link WireHold} has no holds of its own, so a
 * second level is not refused by a check but unsayable in the type. What the wire
 * cannot say either is the store's difference between a fill that was *never
 * solved* and one that was *solved and holds nothing* — both are zero holds here.
 * `link.ts` chooses which of the two a decoded fill becomes, and says why.
 *
 * ## The template and slot tables, and why they are text
 *
 * A `TemplateId` is a slug, mean 41.0 characters over the 40 the build ships and
 * 51 at the widest, and a slot name is a word or two. Neither has a manifest
 * ordinal: templates are not catalog records — none carries `file_metadata`, so
 * none is in `catalog.json` at all (`src/screens/assemblies/templates.ts`) — and
 * a slot name is a field of a template rather than a thing in the corpus. So
 * there is no integer currency to borrow and the identity has to travel as text.
 *
 * It travels **once per distinct value**, for the reason the recipe table already
 * existed: a room is a handful of families repeated, so a table plus a one-byte
 * index per instance replaces 41 characters per instance. Measured on the room
 * shape, writing the three identities inline instead of interning them takes
 * 6,683 instances down to 1,670 — a factor of 4.0, and the largest single win
 * available here. It grew from 3.1x when the filter set joined the tables, which
 * is the same argument arriving a third time: a room repeats its filter position
 * exactly as it repeats its family.
 *
 * **On the scattered shape the tables are worth nothing at all: 80 against 80.**
 * That is not a disappointment, it is the shape's definition — every instance
 * names a different family there, so a 40-entry table plus 80 indices and 80
 * inline strings carry the same information, and deflate reduces the repeated
 * strings about as well as the table does. The tables are therefore a room-build
 * optimisation that is *free* at the tight end rather than a trade between the
 * two ends.
 *
 * The slot table is the same shape of saving on a smaller string: 6 distinct part
 * names carry all 128 parts of the 40 templates.
 *
 * ## The filter table interns a **set**, not a tag
 *
 * One entry per distinct filter *list*, `NUL`-joined, rather than a tag table and
 * a count-plus-indices run per instance. Three reasons, in the order they weigh:
 *
 *   1. **A filter list is one choice.** It is the position of every control axis
 *      at once, and the surfaces treat it as indivisible — `migrations.ts`'s
 *      salvager reduces a malformed list *whole* for the same reason, and half of
 *      `['component|door|arched', 'size|width|2']` is not a narrower filter, it
 *      is a different one nobody chose.
 *   2. **A room repeats the set, not the tags.** A wall run placed as arched
 *      doors is ninety instances of one list, so the set table costs one entry
 *      and one index byte each where a tag run would cost a count plus two to
 *      three indices per instance.
 *   3. It is `writeTable`'s fourth use, unchanged, beside the template, slot and
 *      recipe tables.
 *
 * The empty list is an ordinary entry, so an instance placed at *any* on every
 * axis costs one index byte and the table costs two — and a room where nothing
 * carries a filter has an all-zero column, which is the shape deflate is best at.
 * `capacity.test.ts` measures what that is actually worth.
 *
 * `NUL` because a tag cannot contain one and every printable delimiter can appear
 * in real tag data; it is the same argument every key in this repo makes, and it
 * is written as the escape and never as the byte —
 * `tools/hygiene/source.test.ts` fails the build on the byte.
 *
 * ## Why `pinned` is a bitset and not a byte per fill
 *
 * One bit per fill, LSB first, padding bits zero and **checked to be zero** on
 * the way back in, so one scene has exactly one encoding.
 *
 * A byte column of 0/1 would be simpler, and the expectation was that it would
 * cost nothing on the room shape — a run of identical bytes is what deflate is
 * best at. **Measured, it costs something on both shapes**: 6,683 instances
 * against 6,283 with a byte per fill (+6.4%) on the room build, and 80 against 77
 * (+3.9%) on the scattered one. The room figure is the larger of the two because
 * a room build's `pinned` column is not constant — a room somebody has adjusted
 * has a pinned fill here and there — so a byte per fill is a byte deflate cannot
 * fold into the run beside it.
 *
 * The control switches **both** bitsets, so those figures price the hold bitset
 * beside the fill one; the fixtures fill no holds, so what they actually show is
 * the fill bitset, and the hold one is the same eight lines making the same trade
 * on a column that is empty until a room fits an accessory.
 *
 * Neither figure is large. What decides it is that the *scattered* build is the
 * one that is tight, and there a byte per fill is a byte per fill: that build is
 * incompressible, and at the corpus's arity a link carries three to five of them
 * per placement. Eight lines of bit packing for 3.9% at the tight end and 6.4% at
 * the loose one is worth it; it would not be worth a page.
 *
 * ## The generated half, and why it is a table of strings
 *
 * A generated base is not a catalog file, so there is no manifest ordinal to
 * stand in for it (`src/generator/placement/scene.ts` — it is a third identity).
 * What identifies one is its **recipe**, and the recipe has to travel as text,
 * because the alternative — a positional tuple of parameter values against the
 * pinned `.scad` schema — drops the parameter *names*, and `panel/recipe.ts` is
 * explicit that a recipe which does not record what it meant silently changes
 * meaning the day a `.scad` default moves. A URL sits in a chat log for years;
 * that is the last place to put a positional encoding against a pin.
 *
 * So the table holds one JSON document per **distinct** base, and the placements
 * index into it. The dedup is the whole reason it is affordable: a room is one
 * base recipe repeated, and the measured cost is the *first* document.
 *
 * Measured, `deflate-raw` then base64url, against a 2,000-character URL on
 * `https://openforge.tools/builder` — see `capacity.test.ts`, which prints it.
 * `over no bases` is each row against the first, which is what isolates the
 * generated half from the room it sits on:
 *
 * | scene                                       | chars | over no bases | of budget |
 * | ------------------------------------------- | ----: | ------------: | --------: |
 * | 90 instances, no generated bases            |   398 |             0 |     19.9% |
 * | 90 instances, 1 generated base              |   833 |           435 |     41.6% |
 * | 90 instances, 16 generated bases, 1 recipe  |   862 |           464 |     43.1% |
 * | 90 instances, 90 generated bases, 1 recipe  |   886 |           488 |     44.3% |
 * | 90 instances, 90 generated bases, 3 recipes |   924 |           526 |     46.2% |
 * | 90 instances, 90 gen. bases, 90 recipes     | 2,065 |         1,667 |    103.3% |
 * | 400 instances, 64 gen. bases, 2 recipes     | 1,057 |           659 |     52.8% |
 *
 * **The first base costs 435 characters and the next 89, sharing its recipe, cost
 * 53 between them.** The widest of the five shapes at file defaults is a
 * 242-character recipe key, so a document — the id and the recipe, and the id
 * *is* the key — is 563 bytes raw; deflate takes the ninetieth copy of that text
 * to almost nothing, and the table means it only ever sees one.
 *
 * **The generated half is untouched by row A1 and by format 6 alike, and the
 * `over no bases` column is how that is visible**: the deltas are 435 / 464 /
 * 488 / 526 / 1,667 / 659 against the pre-A1 440 / 478 / 506 / 550 / 1,654 / 626
 * — agreement to within a few characters on every row, across two changes to what
 * a *placement* is. Neither changed what a generated base costs, which is what
 * the column is there to isolate.
 *
 * What *did* change is the room underneath: a ninety-instance room is 398
 * characters where ninety single-tile placements were 130 and where format 5's
 * same room was 338, and **that pushes the adversarial row further over the
 * budget — 2,065 characters, 103.3%, against 100.6% under format 5 and 89.2%
 * before A1.** It is worth naming rather than rounding down. It is also a warning
 * and not a defect: the budget is a threshold rather than a failure (`link.ts`),
 * the codec still produces a working link past it, and the scene is ninety bases
 * on ninety *distinct* recipes, which nobody builds. Every shape anybody does
 * build is in the rows above, at 52.8% of the budget or less. So the loss X9
 * found is still worth the bytes rather than worth refusing.
 *
 * ## Quantisation, and why there is an exact escape hatch
 *
 * Positions are stored in **half grid units** and rotations in **quarter
 * degrees**, which covers every value the app can currently produce: §7 snaps the
 * template origin to 0.5 units, and the finest rotation in the corpus is 11.25°
 * (45 quarter-degrees) on the tiles that carry `size|angle|11.25`.
 *
 * But `TemplateInstance` validates a coordinate as any finite number, on purpose
 * — its docblock says a schema that enforced the snap would reject a legitimate
 * finer mode the day one ships, and §2.2's slot offsets already land off the
 * template lattice. A codec that quantised unconditionally would therefore be
 * **lossy on schema-valid input**, and it would be lossy the way this whole PR is
 * written to avoid: silently, by moving a tile a quarter of a unit. So a column
 * that cannot be represented exactly falls back to float64 for the whole column,
 * flagged in the header. Per column rather than per value because the alternative
 * is an exception list with its own indices — more format, more to get wrong, and
 * it would only ever run on data that does not exist yet.
 *
 * There is deliberately **no rotation per fill** to quantise. §1 places and
 * rotates a template as one unit and `schema.ts#Rotation` states why: the slot
 * offsets are arithmetic against the instance's one angle at fill time, so a
 * per-slot yaw on the wire would be a second copy of a derived value.
 */
import type { LockSystem } from '@/store'

import { ByteReader, ByteWriter, MalformedPayloadError } from './bytes'

/* ---------------------------------------------------------------- constants */

/**
 * Version of *this layout*.
 *
 * Bump it in the same commit that changes a field's position or meaning, so an
 * older link is refused with a clear message instead of read as though the fields
 * were where this build expects them. It is separate from the manifest version:
 * this one says "these bytes are laid out differently", that one says "these
 * integers mean different tiles".
 *
 * **2 — the generated half.** A v1 payload ends after the rotation column, so a
 * v2 reader meeting one runs off the end and a v1 reader meeting a v2 payload
 * finds trailing bytes.
 *
 * **3 — the ordinal column named an item, not a file.** Row V4. Not one byte
 * moved: the field was the same `uvar` in the same position, and only the
 * *meaning* changed.
 *
 * **4 — a placement is a template instance.** Row A5, on row A1's shape. This
 * one moves bytes, and moves more of them than any bump so far: two string
 * tables appear after the digest, the ordinal column becomes three columns and a
 * bitset behind a fill count, and the instance count no longer bounds the number
 * of ordinals in the payload. A v3 reader meeting a v4 payload would read the
 * template table's length prefix as its ordinal column, so the version byte is
 * doing its original job here rather than V4's subtler one.
 *
 * ### An older link is refused, and this time it could not have been read
 *
 * V4's docblock argued at length that a v2 link *could* have been decoded under
 * v3's rules and was refused only because no v2 link existed. **That argument
 * does not transfer, and this is the row where it stops applying.** A v3 payload
 * carries one ordinal per placement and no template at all, and a template is
 * not derivable from a file: `screens/assemblies/templates.ts` maps a family to
 * the tags its slots require, not a tile to the family it might belong to. So
 * there is nothing to read a v3 link *into*, whatever the population.
 *
 * The population is still empty, and `tools/hygiene/project.test.ts` is what
 * keeps it so: no module under `src/` outside `src/share` imports the codec, so
 * nothing in this repo has ever written a link of any version. Row X10 checked
 * that for the 1 -> 2 bump, V4 for 2 -> 3, and it holds for 3 -> 4 and 4 -> 5.
 *
 * **5 — an instance carries its palette filters.** A third string table after the
 * slot table and a sixth per-instance column after the template one. A v4 reader
 * meeting a v5 payload would read the filter table's length prefix as its
 * template column, so this is the version byte's original job again.
 *
 * The filters are **not derivable from the fills** — that is the whole reason
 * they are stored (`store/schema.ts#TemplateInstance.filters`) — so a v4 link
 * could not be read as v5 by defaulting them either: *any component* and *arched
 * door, which happens to be what is filled* produce identical payloads, and
 * guessing the narrower of the two would put a room on screen whose editor
 * offered 54 walls where the sharer's offered 1,451. `[]` would be the honest
 * guess and is exactly what the missing column cannot be distinguished from.
 *
 * **6 — a fill carries the accessories fitted into it.** Four columns after the
 * pinned bitset, and **the first bump an older link survives**: every byte before
 * them is where format 5 put it, and a v5 payload is exactly a v6 payload whose
 * fills all hold nothing. So {@link READABLE_SHARE_FORMATS} carries both and a
 * link written against 5 still opens — see there for why that is a change of
 * situation rather than a change of mind.
 */
export const SHARE_FORMAT_VERSION = 6

/**
 * The formats {@link decodePayload} reads. **Encoding always writes
 * {@link SHARE_FORMAT_VERSION}.**
 *
 * Every bump before 6 moved a byte that a later reader would have read as
 * something else, so refusing the older layout was the version byte doing its
 * job. Format 6 is the first that **appends**: the hold columns sit after the
 * last of format 5's, so reading a v5 payload is reading a v6 payload and
 * stopping where the fill bitset ends. Nothing is guessed to do it — a v5 fill
 * holds nothing, which is what the bytes say and all they could have said.
 *
 * A list rather than a floor, because that is the honest shape: 4 is not readable
 * and 7 is not yet written, and a `>= 5` test would quietly promise the second.
 * A future bump that appends again adds itself here; one that moves a byte
 * replaces the list.
 */
export const READABLE_SHARE_FORMATS: readonly number[] = [5, 6]

/** The first format with the hold columns. Below it, every fill holds nothing. */
const FIRST_FORMAT_WITH_HOLDS = 6

/**
 * Ceiling on the declared instance count.
 *
 * Not a product limit — the URL budget bites long before it (6,683 instances in
 * a 2,000-character link for a room build, and a person will not build 100,000 of
 * them). It is an allocation guard: a hand-edited payload can claim any count,
 * and a reader that trusted it would size an array from a stranger's number. The
 * cheaper check below — count against bytes remaining — catches almost every case
 * first; this catches the rest.
 */
export const MAX_SHARE_PLACEMENTS = 100_000

/**
 * Ceiling on the payload's **total** filled slots and holds, across every
 * instance.
 *
 * A second guard rather than a redundant one, and row A1 is what makes it
 * necessary: the instance count no longer bounds the number of ordinals in the
 * payload, because the fill count column claims a length per instance. Format 6
 * repeats that one level down — the hold count column claims a length per fill —
 * so the two populations are counted against **one** ceiling. Without this,
 * {@link MAX_SHARE_PLACEMENTS} instances each claiming 2^53 fills, or one fill
 * claiming 2^53 holds, would be a header that passes every other check.
 *
 * One number for both because the thing being bounded is the same thing: a file
 * ordinal in the payload, and the array that gets sized from a stranger's claim
 * about how many there are. A hold is a file exactly as a fill is.
 *
 * Five per instance is the corpus's widest template (measured: 40 templates,
 * arities 3 and 5, 128 parts), so this is exactly `MAX_SHARE_PLACEMENTS * 5` —
 * generous against a real scene by the same four orders of magnitude the other
 * two ceilings carry, and cheap to state because the arity is a fact about the
 * shipped table rather than a guess. Holds share the headroom rather than
 * widening it: the measured accessory hit rate puts a hold on a minority of
 * fills, so a real scene is nowhere near either reading of the number.
 */
export const MAX_SHARE_FILLS = 500_000

/**
 * Ceiling on each of the two string tables — templates and slot names.
 *
 * One number for both: the same allocation-guard argument as
 * {@link MAX_SHARE_GENERATED}, and a table entry is a *string*, so a claimed
 * count is a claim about far more than one byte each. The build ships **40
 * templates and 6 distinct slot names**, so this is three orders of magnitude of
 * headroom rather than a product limit — a scene cannot name a template this
 * build does not have, but a link from a future build with more of them must
 * still open.
 */
export const MAX_SHARE_TABLE = 10_000

/**
 * Ceiling on the declared generated-placement count, and on the recipe table.
 *
 * One number for both, and the same allocation-guard argument as
 * {@link MAX_SHARE_PLACEMENTS}: a hand-edited payload can claim any count. The
 * real ceiling is the URL budget, which the measured table above puts at well
 * under a hundred distinct recipes, so this is four orders of magnitude of
 * headroom rather than a product limit.
 *
 * It is lower than {@link MAX_SHARE_PLACEMENTS} because a recipe table entry is
 * a *string*, so a claimed count is a claim about far more than one byte each.
 * The cheaper "count against bytes remaining" check in {@link decodePayload}
 * catches almost every corrupt header first; this catches a header corrupt in a
 * buffer big enough to survive that.
 */
export const MAX_SHARE_GENERATED = 10_000

/**
 * Position quantum: values are stored as `x * 2`, i.e. in half grid units.
 *
 * §7 and `src/catalog/schema.ts#WALL_THICKNESS_UNITS`: every dimension in the
 * catalog is a multiple of 0.5 units, which is why the builder's 0.25 snap was
 * dropped, so a half-unit grid is the whole space of buildable positions.
 */
const COORD_SCALE = 2

/**
 * Rotation quantum: values are stored as `deg * 4`, i.e. in quarter degrees.
 *
 * Chosen from the data rather than for tidiness. The observed `size|angle` values
 * are 90, 45, 22.5, 60, 270, 11.25, 120, 240 and 300; the finest is 11.25°, which
 * is exactly 45 quarter-degrees. A whole-degree quantum would silently round the
 * 893 tiles that carry a non-multiple-of-90 angle.
 */
const ROT_SCALE = 4

const FLAG_X_EXACT = 1
const FLAG_Z_EXACT = 2
const FLAG_ROT_EXACT = 4
const FLAG_GEN_X_EXACT = 8
const FLAG_GEN_Z_EXACT = 16
const FLAG_GEN_ROT_EXACT = 32
const KNOWN_FLAGS =
  FLAG_X_EXACT | FLAG_Z_EXACT | FLAG_ROT_EXACT | FLAG_GEN_X_EXACT | FLAG_GEN_Z_EXACT | FLAG_GEN_ROT_EXACT

/**
 * Lock systems in wire order. **Append-only, for the same reason ordinals are.**
 *
 * The payload stores an index, so reordering this array would change which lock
 * system every link already in the wild resolves with — and §2 makes lock
 * preference the thing that picks the concrete STL for every slot the user has
 * not pinned, so the symptom is a download pack full of the wrong joinery rather
 * than an error. A new system goes on the end; `payload.test.ts` asserts this
 * covers `LockSystem` exactly, so adding one to the enum fails a test rather than
 * shipping a payload that cannot say it.
 */
export const LOCK_ORDER: readonly LockSystem[] = ['openlock', 'dragonlock', 'magnetic']

/* -------------------------------------------------------------------- types */

/**
 * One accessory fitted into a filled file, as the wire sees it: two indices and a
 * bit.
 *
 * `slot` indexes the payload's own slot table — the **same** table the fills
 * index, since a hold name is a string with no manifest ordinal for exactly the
 * reason a slot name is one. `ordinal` is a **manifest ordinal**, which indexes
 * the catalog. The two integers therefore mean nothing like each other, and the
 * field names are the only thing separating them here — `link.ts` is where the
 * brands (`SlotName`, `HoldName`, `TileId`) do the separating, for the reason
 * {@link WireGenerated} gives about its own index.
 *
 * **This is the leaf**, and it is the whole of the nesting rule, restated from
 * `store/schema.ts#HoldFill`: a hold has nowhere to put a hold, so a second level
 * is unsayable rather than refused.
 */
export interface WireHold {
  readonly slot: number
  readonly ordinal: number
  readonly pinned: boolean
}

/**
 * One filled slot as the wire sees it: a {@link WireHold}, plus the accessories
 * fitted into the file it names.
 *
 * Extended rather than restated, mirroring `store/schema.ts` where `SlotFill` is
 * `HoldFill` plus the map: the two answer the same two questions about a file,
 * and the outer one answers a third.
 *
 * `holds` is **nested here and flat in the bytes**, for {@link WireInstance}'s
 * reason one level down — nesting is what makes the type say that a hold belongs
 * to exactly one fill, while the encoder writes each field as its own column.
 * The empty array is the ordinary case and is not a missing value: a fill with no
 * accessories and a fill nobody has looked at are one thing on the wire, and
 * `link.ts` owns the choice of which one a decoded fill becomes.
 */
export interface WireFill extends WireHold {
  readonly holds: readonly WireHold[]
}

/**
 * One template instance as the wire sees it: an index, three numbers, and its
 * fills.
 *
 * The fills are **nested here and flat in the bytes**. Nesting is what makes the
 * type say the thing the format has to guarantee — a fill belongs to exactly one
 * instance — while the encoder writes each field as its own column, which is what
 * the measured table is about. A flat `WireFill[]` plus an instance index per
 * fill would put that association on the wire as a third integer per fill and let
 * a payload contradict itself in a new way.
 *
 * An instance with **no** fills is legal and is not an error: contract C-g and
 * §3.2's "places anyway" make an unfilled slot an ordinary state, so a template
 * dropped on the grid before anything resolves is a room a link has to be able to
 * carry.
 */
export interface WireInstance {
  readonly template: number
  /**
   * Index into {@link WirePayload.filters} — the instance's whole filter list,
   * interned as one set.
   *
   * A separate field from {@link template} and not folded into it, for the reason
   * {@link WireGenerated} gives about its own index: the two address different
   * tables, and a codec that let them be assigned to each other would make a
   * table mix-up a silent wrong room.
   */
  readonly filters: number
  readonly x: number
  readonly z: number
  readonly rotation: number
  readonly fills: readonly WireFill[]
}

/**
 * One generated base as the wire sees it: an index into the recipe table, and
 * the same three numbers.
 *
 * Structurally a {@link WireInstance} without fills and with `recipe` where
 * `template` was, and kept a separate type rather than reusing it under a rename,
 * because the two integers index different tables — and a codec that let them be
 * assigned to each other would make a table mix-up a silent wrong room. Same
 * argument `TagId` and `ManifestOrdinal` are branded apart for in
 * `src/catalog/schema.ts`.
 */
export interface WireGenerated {
  readonly recipe: number
  readonly x: number
  readonly z: number
  readonly rotation: number
}

/**
 * A whole payload, before compression and before any catalog knowledge.
 *
 * `lockIndex` rather than a `LockSystem` because decoding must be able to *report*
 * an index this build does not know — a link written by a future version that
 * added a fourth system — instead of failing to construct the value.
 *
 * The three string arrays are **opaque here**: this module neither parses nor
 * validates them, for the same reason it does not validate an ordinal. `link.ts`
 * runs each through zod — `TemplateId`, `SlotName`, `SharedGeneratedBase` — and
 * drops what it cannot read, by name. What this module does guarantee is that
 * every index into them is in range, because that is internal consistency of the
 * payload rather than meaning.
 */
export interface WirePayload {
  readonly manifestVersion: number
  readonly lockIndex: number
  readonly digest: number
  /** The distinct template ids in the scene. {@link WireInstance.template} indexes this. */
  readonly templates: readonly string[]
  /** The distinct slot names in the scene. {@link WireFill.slot} indexes this. */
  readonly slots: readonly string[]
  /**
   * The distinct filter **sets** in the scene, each a `NUL`-joined tag list.
   * {@link WireInstance.filters} indexes this.
   *
   * Opaque here like the other three tables: this module neither splits nor
   * validates an entry, and `link.ts` is what turns one back into a tag list and
   * reports the ones it cannot read.
   */
  readonly filters: readonly string[]
  readonly instances: readonly WireInstance[]
  /** The distinct generated bases in the scene, as canonical JSON documents. */
  readonly recipes: readonly string[]
  readonly generated: readonly WireGenerated[]
}

/* ------------------------------------------------------------------ columns */

/**
 * Whether every value survives `v * scale` as an exact integer.
 *
 * The second half of the test is the one that matters: `0.1 * 2` is `0.2`, not an
 * integer, so it is caught by `Number.isSafeInteger`; but a value like `1e17`
 * passes that and comes back changed, so the round trip is checked directly
 * rather than assumed from the type.
 */
function quantisable(values: readonly number[], scale: number): boolean {
  return values.every((value) => {
    const scaled = value * scale
    return Number.isSafeInteger(scaled) && scaled / scale === value
  })
}

function writeColumn(writer: ByteWriter, values: readonly number[], scale: number, signed: boolean, exact: boolean) {
  for (const value of values) {
    if (exact) {
      writer.f64(value)
    } else if (signed) {
      writer.zigzag(Math.round(value * scale))
    } else {
      writer.uvar(Math.round(value * scale))
    }
  }
}

function readColumn(reader: ByteReader, count: number, scale: number, signed: boolean, exact: boolean): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (exact) {
      values.push(reader.f64())
    } else if (signed) {
      values.push(reader.zigzag() / scale)
    } else {
      values.push(reader.uvar() / scale)
    }
  }
  return values
}

/** A length-prefixed table of opaque strings. */
function writeTable(writer: ByteWriter, entries: readonly string[]): void {
  writer.uvar(entries.length)
  for (const entry of entries) writer.utf8(entry)
}

/**
 * One bit per value, LSB first, padded with zeros to a byte boundary.
 *
 * The padding is part of the format rather than slack: {@link readBits} refuses a
 * non-zero pad, so a scene has exactly one encoding and "two shares of one scene
 * produce one link" survives a field that does not divide into bytes.
 */
function writeBits(writer: ByteWriter, bits: readonly boolean[]): void {
  for (let start = 0; start < bits.length; start += 8) {
    let byte = 0
    for (let bit = 0; bit < 8 && start + bit < bits.length; bit += 1) {
      if (bits[start + bit] === true) byte |= 1 << bit
    }
    writer.u8(byte)
  }
}

function readBits(reader: ByteReader, count: number): boolean[] {
  const bits: boolean[] = []
  for (let start = 0; start < count; start += 8) {
    const byte = reader.u8()
    const width = Math.min(8, count - start)
    if (width < 8 && byte >>> width !== 0) {
      throw new MalformedPayloadError('payload sets padding bits above the last pinned flag')
    }
    for (let bit = 0; bit < width; bit += 1) bits.push((byte & (1 << bit)) !== 0)
  }
  return bits
}

/* ------------------------------------------------------------------ encoding */

/**
 * Serialise a payload. Synchronous — the compression is the caller's.
 *
 * Throws {@link MalformedPayloadError} only on input this app cannot produce (a
 * count over a ceiling, a lock index off the end, an ordinal that is not a
 * non-negative safe integer, an index off the end of the table it names).
 * Callers construct the input from validated values, so a throw here is a bug in
 * the caller rather than bad user data.
 */
export function encodePayload(payload: WirePayload): Uint8Array {
  const fills = payload.instances.flatMap((instance) => instance.fills)
  const holds = fills.flatMap((fill) => fill.holds)
  refuseUnrepresentable(payload, fills, holds)

  const xs = payload.instances.map((instance) => instance.x)
  const zs = payload.instances.map((instance) => instance.z)
  const rotations = payload.instances.map((instance) => instance.rotation)
  const genXs = payload.generated.map((generated) => generated.x)
  const genZs = payload.generated.map((generated) => generated.z)
  const genRotations = payload.generated.map((generated) => generated.rotation)

  const xExact = !quantisable(xs, COORD_SCALE)
  const zExact = !quantisable(zs, COORD_SCALE)
  const rotExact = !quantisable(rotations, ROT_SCALE)
  const genXExact = !quantisable(genXs, COORD_SCALE)
  const genZExact = !quantisable(genZs, COORD_SCALE)
  const genRotExact = !quantisable(genRotations, ROT_SCALE)

  const writer = new ByteWriter()
  writer.u8(SHARE_FORMAT_VERSION)
  writer.u8(
    (xExact ? FLAG_X_EXACT : 0) |
      (zExact ? FLAG_Z_EXACT : 0) |
      (rotExact ? FLAG_ROT_EXACT : 0) |
      (genXExact ? FLAG_GEN_X_EXACT : 0) |
      (genZExact ? FLAG_GEN_Z_EXACT : 0) |
      (genRotExact ? FLAG_GEN_ROT_EXACT : 0),
  )
  writer.uvar(payload.manifestVersion)
  writer.u8(payload.lockIndex)
  writer.uvar(payload.instances.length)
  writer.u8((payload.digest >>> 24) & 0xff)
  writer.u8((payload.digest >>> 16) & 0xff)
  writer.u8((payload.digest >>> 8) & 0xff)
  writer.u8(payload.digest & 0xff)

  writeTable(writer, payload.templates)
  writeTable(writer, payload.slots)
  writeTable(writer, payload.filters)

  for (const instance of payload.instances) writer.uvar(instance.template)
  for (const instance of payload.instances) writer.uvar(instance.filters)
  writeColumn(writer, xs, COORD_SCALE, true, xExact)
  writeColumn(writer, zs, COORD_SCALE, true, zExact)
  writeColumn(writer, rotations, ROT_SCALE, false, rotExact)

  for (const instance of payload.instances) writer.uvar(instance.fills.length)
  for (const fill of fills) writer.uvar(fill.slot)
  for (const fill of fills) writer.uvar(fill.ordinal)
  writeBits(
    writer,
    fills.map((fill) => fill.pinned),
  )

  for (const fill of fills) writer.uvar(fill.holds.length)
  for (const hold of holds) writer.uvar(hold.slot)
  for (const hold of holds) writer.uvar(hold.ordinal)
  writeBits(
    writer,
    holds.map((hold) => hold.pinned),
  )

  writeTable(writer, payload.recipes)
  writer.uvar(payload.generated.length)
  for (const generated of payload.generated) writer.uvar(generated.recipe)
  writeColumn(writer, genXs, COORD_SCALE, true, genXExact)
  writeColumn(writer, genZs, COORD_SCALE, true, genZExact)
  writeColumn(writer, genRotations, ROT_SCALE, false, genRotExact)

  return writer.bytes()
}

/**
 * The encoder's precondition checks, in one place.
 *
 * Split out of {@link encodePayload} because they are a list rather than a
 * procedure, and because every one of them is the same kind of statement: this
 * payload could be written, but nothing could read it back as what it says.
 */
function refuseUnrepresentable(
  payload: WirePayload,
  fills: readonly WireFill[],
  holds: readonly WireHold[],
): void {
  if (payload.instances.length > MAX_SHARE_PLACEMENTS) {
    throw new MalformedPayloadError(
      `${String(payload.instances.length)} instances exceeds the ${String(MAX_SHARE_PLACEMENTS)} the format carries`,
    )
  }
  if (fills.length + holds.length > MAX_SHARE_FILLS) {
    throw new MalformedPayloadError(
      `${String(fills.length)} filled slots and ${String(holds.length)} holds exceeds the ` +
        `${String(MAX_SHARE_FILLS)} the format carries`,
    )
  }
  if (!Number.isInteger(payload.lockIndex) || payload.lockIndex < 0 || payload.lockIndex > 0xff) {
    throw new MalformedPayloadError(`lock index ${String(payload.lockIndex)} does not fit one byte`)
  }
  const widest = Math.max(payload.templates.length, payload.slots.length, payload.filters.length)
  if (widest > MAX_SHARE_TABLE) {
    throw new MalformedPayloadError(
      `a table of ${String(widest)} entries exceeds the ${String(MAX_SHARE_TABLE)} the format carries`,
    )
  }
  if (payload.generated.length > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `${String(payload.generated.length)} generated bases exceeds the ${String(MAX_SHARE_GENERATED)} the format carries`,
    )
  }
  if (payload.recipes.length > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `${String(payload.recipes.length)} recipes exceeds the ${String(MAX_SHARE_GENERATED)} the format carries`,
    )
  }
  for (const instance of payload.instances) {
    if (!indexes(instance.template, payload.templates.length)) {
      throw new MalformedPayloadError(
        `instance names template ${String(instance.template)} of ${String(payload.templates.length)}`,
      )
    }
    if (!indexes(instance.filters, payload.filters.length)) {
      throw new MalformedPayloadError(
        `instance names filters ${String(instance.filters)} of ${String(payload.filters.length)}`,
      )
    }
  }
  for (const fill of fills) {
    if (!indexes(fill.slot, payload.slots.length)) {
      throw new MalformedPayloadError(`fill names slot ${String(fill.slot)} of ${String(payload.slots.length)}`)
    }
  }
  for (const hold of holds) {
    if (!indexes(hold.slot, payload.slots.length)) {
      throw new MalformedPayloadError(`hold names slot ${String(hold.slot)} of ${String(payload.slots.length)}`)
    }
  }
  for (const generated of payload.generated) {
    if (!indexes(generated.recipe, payload.recipes.length)) {
      throw new MalformedPayloadError(
        `generated base names recipe ${String(generated.recipe)} of ${String(payload.recipes.length)}`,
      )
    }
  }
}

/** Whether `value` is a usable index into a table of `length` entries. */
function indexes(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length
}

/* ------------------------------------------------------------------ decoding */

/** The format version a payload declares, or `undefined` if it is empty. */
export function payloadFormatVersion(bytes: Uint8Array): number | undefined {
  return bytes[0]
}

/**
 * Read a payload back.
 *
 * Throws `TruncatedPayloadError` or {@link MalformedPayloadError}; `link.ts` turns
 * both into typed failures. It does **not** validate meanings — an ordinal no
 * catalog holds, a template id no build ships, a lock index no build knows and a
 * rotation of 900° all come back as written, because whether each of those is
 * recoverable depends on the manifest and the template table, and neither is this
 * module's business.
 *
 * The format version is checked first and hardest. Everything after byte 0 is
 * positional, so reading a v4 payload with v3's field offsets would not fail — it
 * would succeed, and produce a different room.
 */
export function decodePayload(bytes: Uint8Array): WirePayload {
  const reader = new ByteReader(bytes)

  const format = reader.u8()
  if (!READABLE_SHARE_FORMATS.includes(format)) {
    throw new MalformedPayloadError(
      `payload format ${String(format)} is not ${READABLE_SHARE_FORMATS.join(' or ')}; ` +
        'the fields would be read from the wrong offsets',
    )
  }

  const flags = reader.u8()
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new MalformedPayloadError(`payload sets unknown flag bits (0x${flags.toString(16)})`)
  }

  const manifestVersion = reader.uvar()
  const lockIndex = reader.u8()
  const count = reader.uvar()

  if (count > MAX_SHARE_PLACEMENTS) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} instances, above the ${String(MAX_SHARE_PLACEMENTS)} limit`,
    )
  }
  // Six columns, at least one byte per value in the cheapest encoding — the five
  // an instance always has, plus its fill count. The digest, the tables and the
  // generated half only add to what is left, so a count that cannot fit in the
  // remaining bytes is a corrupt header, and saying so beats allocating for it
  // and failing later with "truncated".
  if (count * 6 > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} instances but holds ${String(reader.remaining)} more bytes`,
    )
  }

  const digest = ((reader.u8() << 24) | (reader.u8() << 16) | (reader.u8() << 8) | reader.u8()) >>> 0

  const templates = readTable(reader, 'templates')
  const slots = readTable(reader, 'slot names')
  const filters = readTable(reader, 'filter sets')

  const templateIndices: number[] = []
  for (let i = 0; i < count; i += 1) templateIndices.push(reader.uvar())
  const filterIndices: number[] = []
  for (let i = 0; i < count; i += 1) filterIndices.push(reader.uvar())
  const xs = readColumn(reader, count, COORD_SCALE, true, (flags & FLAG_X_EXACT) !== 0)
  const zs = readColumn(reader, count, COORD_SCALE, true, (flags & FLAG_Z_EXACT) !== 0)
  const rotations = readColumn(reader, count, ROT_SCALE, false, (flags & FLAG_ROT_EXACT) !== 0)

  const fillCounts = readFillCounts(reader, count)
  const total = fillCounts.reduce((sum, fills) => sum + fills, 0)

  const slotIndices: number[] = []
  for (let i = 0; i < total; i += 1) slotIndices.push(reader.uvar())
  const ordinals: number[] = []
  for (let i = 0; i < total; i += 1) ordinals.push(reader.uvar())
  const pinned = readBits(reader, total)

  // A format 5 payload ends the fills here, and that is the whole of reading one:
  // no hold counts, and every fill holds nothing.
  const holdCounts = format >= FIRST_FORMAT_WITH_HOLDS ? readHoldCounts(reader, total) : []
  const heldTotal = holdCounts.reduce((sum, holds) => sum + holds, 0)

  const holdSlots: number[] = []
  for (let i = 0; i < heldTotal; i += 1) holdSlots.push(reader.uvar())
  const holdOrdinals: number[] = []
  for (let i = 0; i < heldTotal; i += 1) holdOrdinals.push(reader.uvar())
  const holdPinned = readBits(reader, heldTotal)

  const recipes = readTable(reader, 'recipes', MAX_SHARE_GENERATED)

  const genCount = reader.uvar()
  if (genCount > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `payload claims ${String(genCount)} generated bases, above the ${String(MAX_SHARE_GENERATED)} limit`,
    )
  }
  if (genCount * 4 > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(genCount)} generated bases but holds ${String(reader.remaining)} more bytes`,
    )
  }
  const recipeIndices: number[] = []
  for (let i = 0; i < genCount; i += 1) recipeIndices.push(reader.uvar())
  const genXs = readColumn(reader, genCount, COORD_SCALE, true, (flags & FLAG_GEN_X_EXACT) !== 0)
  const genZs = readColumn(reader, genCount, COORD_SCALE, true, (flags & FLAG_GEN_Z_EXACT) !== 0)
  const genRotations = readColumn(reader, genCount, ROT_SCALE, false, (flags & FLAG_GEN_ROT_EXACT) !== 0)

  if (!reader.atEnd) {
    throw new MalformedPayloadError('payload has trailing bytes after the last column')
  }

  const instances = assembleInstances(
    { count, templateIndices, filterIndices, xs, zs, rotations },
    fillCounts,
    {
      slotIndices,
      ordinals,
      pinned,
      holds: { counts: holdCounts, slotIndices: holdSlots, ordinals: holdOrdinals, pinned: holdPinned },
      slots: slots.length,
      templates: templates.length,
      filters: filters.length,
    },
  )

  const generated: WireGenerated[] = []
  for (let i = 0; i < genCount; i += 1) {
    const recipe = recipeIndices[i] ?? 0
    if (!indexes(recipe, recipes.length)) {
      throw new MalformedPayloadError(
        `generated base ${String(i)} names recipe ${String(recipe)} of ${String(recipes.length)}`,
      )
    }
    generated.push({ recipe, x: genXs[i] ?? 0, z: genZs[i] ?? 0, rotation: genRotations[i] ?? 0 })
  }

  return { manifestVersion, lockIndex, digest, templates, slots, filters, instances, recipes, generated }
}

/** The flat fill and hold columns, and the table lengths their indices must be in. */
interface FlatColumns {
  readonly slotIndices: readonly number[]
  readonly ordinals: readonly number[]
  readonly pinned: readonly boolean[]
  readonly holds: {
    readonly counts: readonly number[]
    readonly slotIndices: readonly number[]
    readonly ordinals: readonly number[]
    readonly pinned: readonly boolean[]
  }
  readonly slots: number
  readonly templates: number
  readonly filters: number
}

/** How far through the fill columns and the hold columns the re-split has read. */
interface Cursors {
  fill: number
  hold: number
}

/**
 * Re-split the flat fill columns into the instances they belong to.
 *
 * The one place where an off-by-one would hand one instance's floor to the next
 * one — a plausible wrong room with no error anywhere — so it is its own function
 * with the cursors visible, and `payload.test.ts` exercises it at mixed arity.
 *
 * **Two cursors, because format 6 nests one flat run inside another**: the fill
 * cursor is stepped by the fill count column, per instance, and the hold cursor
 * by the hold count column, per fill. They are one object so that the hold reader
 * below can advance the second without returning it alongside its result.
 *
 * The index checks are internal consistency, not meaning: the tables these
 * indices address are in the same payload, so an index off the end is the payload
 * contradicting itself. Left to `link.ts` they would have to become `dropped`
 * reasons for a condition no encoder can produce.
 */
function assembleInstances(
  columns: {
    count: number
    templateIndices: readonly number[]
    filterIndices: readonly number[]
    xs: readonly number[]
    zs: readonly number[]
    rotations: readonly number[]
  },
  fillCounts: readonly number[],
  flat: FlatColumns,
): WireInstance[] {
  const instances: WireInstance[] = []
  const cursors: Cursors = { fill: 0, hold: 0 }
  for (let i = 0; i < columns.count; i += 1) {
    const fills: WireFill[] = []
    for (let n = 0; n < (fillCounts[i] ?? 0); n += 1) {
      const cursor = cursors.fill
      const slot = flat.slotIndices[cursor] ?? 0
      if (!indexes(slot, flat.slots)) {
        throw new MalformedPayloadError(
          `instance ${String(i)} names slot ${String(slot)} of ${String(flat.slots)}`,
        )
      }
      // Before the cursor moves on, because the holds of *this* fill are the next
      // `holds.counts[cursor]` entries of the hold columns.
      const holds = takeHolds(flat, cursors, flat.holds.counts[cursor] ?? 0, i)
      fills.push({ slot, ordinal: flat.ordinals[cursor] ?? 0, pinned: flat.pinned[cursor] ?? false, holds })
      cursors.fill += 1
    }
    const template = columns.templateIndices[i] ?? 0
    if (!indexes(template, flat.templates)) {
      throw new MalformedPayloadError(
        `instance ${String(i)} names template ${String(template)} of ${String(flat.templates)}`,
      )
    }
    const filters = columns.filterIndices[i] ?? 0
    if (!indexes(filters, flat.filters)) {
      throw new MalformedPayloadError(
        `instance ${String(i)} names filters ${String(filters)} of ${String(flat.filters)}`,
      )
    }
    instances.push({
      template,
      filters,
      x: columns.xs[i] ?? 0,
      z: columns.zs[i] ?? 0,
      rotation: columns.rotations[i] ?? 0,
      fills,
    })
  }
  return instances
}

/**
 * The next `count` entries of the hold columns, advancing the hold cursor past
 * them.
 *
 * Its own function rather than a second nested loop, because the fill loop above
 * is already the one place an off-by-one is invisible and a third level of
 * indentation is how it would get there. `instance` is carried only to name the
 * instance in the one error this can raise.
 */
function takeHolds(flat: FlatColumns, cursors: Cursors, count: number, instance: number): WireHold[] {
  const holds: WireHold[] = []
  for (let n = 0; n < count; n += 1) {
    const cursor = cursors.hold
    const slot = flat.holds.slotIndices[cursor] ?? 0
    if (!indexes(slot, flat.slots)) {
      throw new MalformedPayloadError(
        `instance ${String(instance)} names hold slot ${String(slot)} of ${String(flat.slots)}`,
      )
    }
    holds.push({
      slot,
      ordinal: flat.holds.ordinals[cursor] ?? 0,
      pinned: flat.holds.pinned[cursor] ?? false,
    })
    cursors.hold += 1
  }
  return holds
}

/**
 * Read one length-prefixed string table.
 *
 * A table entry costs at least its own one-byte length prefix, so a count above
 * the bytes left cannot be honoured. Saying so beats allocating for it.
 */
function readTable(reader: ByteReader, what: string, limit = MAX_SHARE_TABLE): string[] {
  const count = reader.uvar()
  if (count > limit) {
    throw new MalformedPayloadError(`payload claims ${String(count)} ${what}, above the ${String(limit)} limit`)
  }
  if (count > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} ${what} but holds ${String(reader.remaining)} more bytes`,
    )
  }
  const entries: string[] = []
  for (let i = 0; i < count; i += 1) entries.push(reader.utf8())
  return entries
}

/**
 * Read the fill count column, bounding the total as it goes.
 *
 * The running check is the point: a single instance may claim any `uvar`, so the
 * total is what has to be guarded, and guarding it *during* the read means a
 * payload claiming 2^53 fills is refused before anything is sized from it.
 */
function readFillCounts(reader: ByteReader, count: number): number[] {
  const fillCounts: number[] = []
  let total = 0
  for (let i = 0; i < count; i += 1) {
    const fills = reader.uvar()
    total += fills
    if (total > MAX_SHARE_FILLS) {
      throw new MalformedPayloadError(
        `payload claims more than ${String(MAX_SHARE_FILLS)} filled slots, above the limit`,
      )
    }
    fillCounts.push(fills)
  }
  // Two varint columns and a bit, so two bytes per fill at the very cheapest.
  // Still two and not three under format 6, whose hold count column adds a byte
  // per fill: a v5 payload is read by this same function and has no such column,
  // and a lower bound that held for only one of the two formats would refuse
  // readable bytes to save a comparison.
  if (total * 2 > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(total)} filled slots but holds ${String(reader.remaining)} more bytes`,
    )
  }
  return fillCounts
}

/**
 * Read the hold count column, bounding the total against the fills already read.
 *
 * The same running guard as {@link readFillCounts} and against the same ceiling,
 * because {@link MAX_SHARE_FILLS} counts both: a single fill may claim any
 * `uvar` of holds, so a payload of two innocent-looking fills can still claim
 * half a billion files.
 */
function readHoldCounts(reader: ByteReader, fills: number): number[] {
  const holdCounts: number[] = []
  let total = fills
  for (let i = 0; i < fills; i += 1) {
    const holds = reader.uvar()
    total += holds
    if (total > MAX_SHARE_FILLS) {
      throw new MalformedPayloadError(
        `payload claims more than ${String(MAX_SHARE_FILLS)} filled slots and holds, above the limit`,
      )
    }
    holdCounts.push(holds)
  }
  // Two varint columns and a bit again, so two bytes per hold at the cheapest.
  const claimed = total - fills
  if (claimed * 2 > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(claimed)} holds but holds ${String(reader.remaining)} more bytes`,
    )
  }
  return holdCounts
}
