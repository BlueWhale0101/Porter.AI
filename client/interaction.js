/**
 * Dialog ownership is explicit: an older dialog can never release a newer
 * interaction that replaced it (for example Details handing off to Door Mode).
 */
export class InteractionController {
  #owner = null;
  begin(kind) { const owner = { kind }; this.#owner = owner; return owner; }
  owns(owner) { return this.#owner === owner; }
  get active() { return this.#owner !== null; }
  get kind() { return this.#owner?.kind ?? null; }
  release(owner) { if (this.#owner !== owner) return false; this.#owner = null; return true; }
}

export async function releaseAndAdoptIfSafe(controller, owner, deferredPacket, adopt) {
  if (!controller.release(owner)) return deferredPacket;
  if (deferredPacket) await adopt(deferredPacket);
  return null;
}
