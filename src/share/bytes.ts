/**
 * The byte primitives the share payload is built from: varints, zigzag, float64.
 *
 * Small and dull on purpose. It exists as its own module because the payload
 * codec is the one place in the app where a **one-byte disagreement between the
 * writer and the reader silently produces a different room** — every field after
 * the mistake shifts, and the result still decodes to something plausible. Having
 * the two halves sit beside each other, over one buffer abstraction, is what makes
 * that reviewable.
 *
 * ## Why varints rather than fixed-width fields
 *
 * Every quantity in a scene is small and most are tiny: a manifest ordinal is at
 * most 4 digits (8,702 live tiles), a coordinate in half-units fits a byte for any
 * room a person actually builds, and a rotation in quarter-degrees needs 11 bits
 * at the very outside. A fixed 32-bit field would spend three bytes per value
 * saying zero. Deflate would recover much of that in a repetitive room build and
 * almost none of it in a scattered one — which is exactly the case where the URL
 * budget is tight. Measured: the scattered build is *incompressible*, so its
 * capacity is set by the raw byte count and nothing else.
 *
 * ## Reads throw; the public API catches
 *
 * Every read is bounds-checked and throws {@link TruncatedPayloadError} rather
 * than returning a sentinel, because a sentinel would have to be a number and
 * every number is a legal field value. `src/share/link.ts` catches at the module
 * boundary and converts to a typed failure — nothing outside `src/share` ever
 * sees one of these.
 */

/** A read ran past the end of the buffer: the payload was cut short. */
export class TruncatedPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TruncatedPayloadError'
  }
}

/** The bytes were readable but say something impossible. */
export class MalformedPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedPayloadError'
  }
}

/**
 * Largest varint this codec will read or write, in bytes.
 *
 * Eight bytes carry 56 bits, which covers every `Number.isSafeInteger` value. The
 * cap is not a size limit but a **termination guarantee**: without it, a run of
 * bytes with the continuation bit set — which is what a hand-truncated base64
 * string decodes to about half the time — would spin until the buffer ended, and
 * the resulting number would be nonsense either way.
 */
const MAX_VARINT_BYTES = 8

/** Growable output buffer. */
export class ByteWriter {
  private readonly out: number[] = []

  /** One unsigned byte. Values outside 0–255 are a programming error, so masked. */
  u8(value: number): void {
    this.out.push(value & 0xff)
  }

  /**
   * LEB128 unsigned varint: seven bits per byte, high bit continues.
   *
   * Arithmetic rather than bitwise, because `>>>` truncates to 32 bits and a
   * quantised coordinate can legitimately exceed that — silently, and only for
   * the user who typed a big number into a future numeric position field.
   */
  uvar(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MalformedPayloadError(`cannot write ${String(value)} as an unsigned varint`)
    }
    let rest = value
    while (rest >= 0x80) {
      this.out.push((rest % 0x80) | 0x80)
      rest = Math.floor(rest / 0x80)
    }
    this.out.push(rest)
  }

  /** Zigzag then varint, so a small negative costs one byte rather than eight. */
  zigzag(value: number): void {
    this.uvar(value < 0 ? -2 * value - 1 : 2 * value)
  }

  /** Little-endian IEEE-754 double — the exact escape hatch, eight bytes. */
  f64(value: number): void {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value, true)
    for (let i = 0; i < 8; i += 1) this.out.push(view.getUint8(i))
  }

  /** Bytes written so far, copied. */
  bytes(): Uint8Array {
    return Uint8Array.from(this.out)
  }
}

/** Bounds-checked cursor over a payload. */
export class ByteReader {
  private readonly source: Uint8Array
  private at = 0

  constructor(source: Uint8Array) {
    this.source = source
  }

  /** True when every byte has been consumed. */
  get atEnd(): boolean {
    return this.at >= this.source.length
  }

  /** Bytes not yet read — used to reject an impossible declared count early. */
  get remaining(): number {
    return Math.max(0, this.source.length - this.at)
  }

  u8(): number {
    const value = this.source[this.at]
    if (value === undefined) {
      throw new TruncatedPayloadError(`payload ends at byte ${String(this.at)}, expected one more`)
    }
    this.at += 1
    return value
  }

  uvar(): number {
    let value = 0
    let scale = 1
    for (let i = 0; i < MAX_VARINT_BYTES; i += 1) {
      const byte = this.u8()
      value += (byte & 0x7f) * scale
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) {
          throw new MalformedPayloadError(`varint at byte ${String(this.at)} is not a safe integer`)
        }
        return value
      }
      scale *= 0x80
    }
    throw new MalformedPayloadError(`varint at byte ${String(this.at)} runs past ${String(MAX_VARINT_BYTES)} bytes`)
  }

  zigzag(): number {
    const value = this.uvar()
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2
  }

  f64(): number {
    const view = new DataView(new ArrayBuffer(8))
    for (let i = 0; i < 8; i += 1) view.setUint8(i, this.u8())
    return view.getFloat64(0, true)
  }
}
