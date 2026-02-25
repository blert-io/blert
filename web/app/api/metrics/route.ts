import logger from '@/utils/log';
import { getMetricsSnapshot, metricsContentType } from '@/utils/metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const metrics = await getMetricsSnapshot();
    return new Response(metrics, {
      headers: { 'Content-Type': metricsContentType },
    });
  } catch (e) {
    logger.error('metrics_endpoint_failure', {
      error: e instanceof Error ? e.message : String(e),
    });
    return new Response('metrics_unavailable', { status: 500 });
  }
}
