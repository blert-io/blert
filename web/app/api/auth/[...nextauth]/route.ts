import { handlers } from '@/auth';

// TODO(frolv): This is a workaround around Next 16 changing the Request type.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const { GET, POST } = handlers as { GET: any; POST: any };
