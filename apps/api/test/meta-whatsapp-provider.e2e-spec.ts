import { ConfigService } from '@nestjs/config';
import { MetaWhatsAppProvider } from '../src/notifications/providers/meta-whatsapp.provider';

jest.setTimeout(30_000);

/**
 * WhatsApp Integration (Stage 4C) Phase 1 — tests MetaWhatsAppProvider in
 * complete isolation: no DB, no Nest app, no real network call. `fetch` is
 * mocked directly so these assertions are about THIS class's own request
 * construction and response handling, never about Meta's real API or
 * network conditions — matching the spirit of public-ai-agent.e2e-spec.ts
 * mocking PUBLIC_AGENT_PROVIDER for the same reason (no tokens spent, no
 * external dependency, deterministic).
 */
describe('MetaWhatsAppProvider — request construction and failure handling (e2e)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function makeConfig(vars: Record<string, string>): ConfigService {
    return {
      get: (key: string, defaultValue?: unknown) => vars[key] ?? defaultValue,
    } as unknown as ConfigService;
  }

  it('1. refuses to send without an approved template — never falls back to freeform text', async () => {
    const provider = new MetaWhatsAppProvider(makeConfig({}));
    const result = await provider.send({ to: '+233201234567', body: 'freeform text', tenantId: 'tenant-1' });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/approved WhatsApp template/i);
  });

  it('2. returns a graceful failure (never throws) when Meta credentials are not configured', async () => {
    const provider = new MetaWhatsAppProvider(makeConfig({}));
    const result = await provider.send({
      to: '+233201234567',
      body: 'fallback text',
      template: { name: 'shipment_status_update', language: 'en_US', params: ['TAL-2026-000123', 'Departed'] },
      tenantId: 'tenant-1',
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/not configured/i);
  });

  it('3. constructs the exact Meta Graph API request shape for a template send', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.mocked123' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new MetaWhatsAppProvider(
      makeConfig({
        META_WHATSAPP_ACCESS_TOKEN: 'test-token',
        META_WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      }),
    );

    const result = await provider.send({
      to: '+233201234567',
      body: 'Your shipment TAL-2026-000123 status: Departed origin.',
      template: { name: 'shipment_status_update', language: 'en_US', params: ['TAL-2026-000123', 'Departed origin'] },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ success: true, providerMessageId: 'wamid.mocked123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-token');

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '+233201234567',
      type: 'template',
      template: {
        name: 'shipment_status_update',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'TAL-2026-000123' },
              { type: 'text', text: 'Departed origin' },
            ],
          },
        ],
      },
    });
  });

  it('4. uses a configured META_WHATSAPP_API_VERSION override instead of the default', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'x' }] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new MetaWhatsAppProvider(
      makeConfig({
        META_WHATSAPP_ACCESS_TOKEN: 'test-token',
        META_WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        META_WHATSAPP_API_VERSION: 'v99.0',
      }),
    );

    await provider.send({
      to: '+233201234567',
      body: 'x',
      template: { name: 't', language: 'en_US', params: [] },
      tenantId: 'tenant-1',
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://graph.facebook.com/v99.0/1234567890/messages');
  });

  it('5. returns a graceful failure (never throws) when Meta responds with a non-2xx status', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid OAuth access token.', code: 190 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new MetaWhatsAppProvider(
      makeConfig({ META_WHATSAPP_ACCESS_TOKEN: 'bad-token', META_WHATSAPP_PHONE_NUMBER_ID: '1234567890' }),
    );

    const result = await provider.send({
      to: '+233201234567',
      body: 'x',
      template: { name: 't', language: 'en_US', params: [] },
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Invalid OAuth access token.');
  });

  it('6. returns a graceful failure (never throws) when fetch itself rejects (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const provider = new MetaWhatsAppProvider(
      makeConfig({ META_WHATSAPP_ACCESS_TOKEN: 'test-token', META_WHATSAPP_PHONE_NUMBER_ID: '1234567890' }),
    );

    const result = await provider.send({
      to: '+233201234567',
      body: 'x',
      template: { name: 't', language: 'en_US', params: [] },
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ECONNRESET');
  });
});
