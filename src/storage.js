/** Provider-neutral artifact storage contract. storageRef is opaque to callers. */
export class ArtifactStorage {
  async put(_input) { throw new Error('Not implemented'); }
  async get(_storageRef) { throw new Error('Not implemented'); }
  async delete(_storageRef) { throw new Error('Not implemented'); }
  async exists(_storageRef) { throw new Error('Not implemented'); }
  async downloadReference(_storageRef) { throw new Error('Not implemented'); }
  async checksum(_storageRef) { throw new Error('Not implemented'); }
}
