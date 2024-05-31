import { S3Client } from '@aws-sdk/client-s3';
import { DataRepository } from '@blert/common';

let repositoryBackend: DataRepository.Backend;
if (!process.env.BLERT_DATA_REPOSITORY) {
  throw new Error('BLERT_DATA_REPOSITORY is not set');
} else if (process.env.BLERT_DATA_REPOSITORY.startsWith('file://')) {
  const root = process.env.BLERT_DATA_REPOSITORY.slice('file://'.length);
  repositoryBackend = new DataRepository.FilesystemBackend(root);
} else if (process.env.BLERT_DATA_REPOSITORY.startsWith('s3://')) {
  const s3Client = new S3Client({
    forcePathStyle: false,
    region: process.env.BLERT_REGION,
    endpoint: process.env.BLERT_ENDPOINT,
    credentials: {
      accessKeyId: process.env.BLERT_ACCESS_KEY_ID!,
      secretAccessKey: process.env.BLERT_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.BLERT_DATA_REPOSITORY.slice('s3://'.length);
  repositoryBackend = new DataRepository.S3Backend(s3Client, bucket);
} else {
  throw new Error('Unknown repository backend');
}

const repository = new DataRepository(repositoryBackend);
export default repository;
