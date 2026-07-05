import { incCounter, observeHistogram, renderMetrics, resetMetrics } from '../../src/lib/metrics';

describe('metrics registry', () => {
  beforeEach(() => resetMetrics());

  it('renders an empty string when nothing has been recorded', () => {
    expect(renderMetrics()).toBe('');
  });

  describe('incCounter', () => {
    it('accumulates repeated increments for the same labels', () => {
      incCounter('http_requests_total', 'Total HTTP requests', { method: 'GET', path: '/health', status: '200' });
      incCounter('http_requests_total', 'Total HTTP requests', { method: 'GET', path: '/health', status: '200' });

      const body = renderMetrics();
      expect(body).toContain('# HELP http_requests_total Total HTTP requests');
      expect(body).toContain('# TYPE http_requests_total counter');
      expect(body).toContain('http_requests_total{method="GET",path="/health",status="200"} 2');
    });

    it('tracks distinct label sets separately', () => {
      incCounter('http_requests_total', 'Total HTTP requests', { method: 'GET', path: '/health', status: '200' });
      incCounter('http_requests_total', 'Total HTTP requests', { method: 'POST', path: '/prompt/add', status: '201' });

      const body = renderMetrics();
      expect(body).toContain('http_requests_total{method="GET",path="/health",status="200"} 1');
      expect(body).toContain('http_requests_total{method="POST",path="/prompt/add",status="201"} 1');
    });

    it('supports a custom increment value', () => {
      incCounter('callback_deliveries_total', 'Total callback delivery attempts', { result: 'success' }, 3);
      expect(renderMetrics()).toContain('callback_deliveries_total{result="success"} 3');
    });

    it('renders a metric with no labels using a bare name', () => {
      incCounter('some_counter_total', 'A counter with no labels');
      expect(renderMetrics()).toContain('some_counter_total 1');
    });
  });

  describe('observeHistogram', () => {
    it('increments only the buckets whose bound is >= the observed value, cumulatively', () => {
      observeHistogram('http_request_duration_seconds', 'HTTP request duration', {}, 0.2, [0.1, 0.5, 1]);

      const body = renderMetrics();
      expect(body).toContain('# TYPE http_request_duration_seconds histogram');
      expect(body).toContain('http_request_duration_seconds_bucket{le="0.1"} 0');
      expect(body).toContain('http_request_duration_seconds_bucket{le="0.5"} 1');
      expect(body).toContain('http_request_duration_seconds_bucket{le="1"} 1');
      expect(body).toContain('http_request_duration_seconds_bucket{le="+Inf"} 1');
      expect(body).toContain('http_request_duration_seconds_sum 0.2');
      expect(body).toContain('http_request_duration_seconds_count 1');
    });

    it('accumulates sum and count across multiple observations with the same labels', () => {
      observeHistogram('openai_request_duration_seconds', 'OpenAI duration', {}, 0.5, [1, 5]);
      observeHistogram('openai_request_duration_seconds', 'OpenAI duration', {}, 2, [1, 5]);

      const body = renderMetrics();
      expect(body).toContain('openai_request_duration_seconds_bucket{le="1"} 1');
      expect(body).toContain('openai_request_duration_seconds_bucket{le="5"} 2');
      expect(body).toContain('openai_request_duration_seconds_sum 2.5');
      expect(body).toContain('openai_request_duration_seconds_count 2');
    });

    it('keeps separate bucket counts per label set', () => {
      observeHistogram('openai_request_duration_seconds', 'OpenAI duration', { result: 'success' }, 0.5, [1]);
      observeHistogram('openai_request_duration_seconds', 'OpenAI duration', { result: 'failure' }, 5, [1]);

      const body = renderMetrics();
      expect(body).toContain('openai_request_duration_seconds_bucket{le="1",result="success"} 1');
      expect(body).toContain('openai_request_duration_seconds_bucket{le="1",result="failure"} 0');
    });
  });

  describe('resetMetrics', () => {
    it('clears all recorded counters and histograms', () => {
      incCounter('http_requests_total', 'Total HTTP requests', { method: 'GET', path: '/health', status: '200' });
      observeHistogram('http_request_duration_seconds', 'HTTP request duration', {}, 0.1);

      resetMetrics();

      expect(renderMetrics()).toBe('');
    });
  });
});
