import { DataRepository } from '@blert/common';

let repositoryBackend: DataRepository.Backend;
if (!process.env.BLERT_DATA_REPOSITORY) {
  throw new Error('BLERT_DATA_REPOSITORY is not set');
} else if (process.env.BLERT_DATA_REPOSITORY.startsWith('file://')) {
  const root = process.env.BLERT_DATA_REPOSITORY.slice('file://'.length);
  repositoryBackend = new DataRepository.FilesystemBackend(root);
} else {
  throw new Error('Unimplemented');
}

export default new DataRepository(repositoryBackend);
