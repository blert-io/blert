import { useEffect, useState } from 'react';

/**
 * React hook to ensure that (part of) a component is only rendered on the
 * client.
 * @returns Whether the component is being rendered on the client.
 */
export function useClientOnly() {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  return isClient;
}
