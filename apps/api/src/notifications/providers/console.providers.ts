import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { EmailProvider, ProviderSendResult, SmsProvider, WhatsAppProvider } from './provider.types';

/**
 * Stage 3H: the default provider for every channel until a real
 * email/SMS/WhatsApp account is connected (see StorageModule/
 * StripeService for the same "console/local default until real
 * credentials exist" pattern already used for storage and payments).
 * Logs what *would* have been sent and returns success with a fake
 * provider message id, so the whole notification pipeline — including
 * Notification.status ending up SENT, not stuck PENDING or wrongly
 * FAILED — is fully exercised in dev/test without any external account.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('EmailProvider(console)');

  async send(params: { to: string; subject: string; body: string }): Promise<ProviderSendResult> {
    this.logger.log(`[SIMULATED EMAIL] to=${params.to} subject="${params.subject}" body="${params.body}"`);
    return { success: true, providerMessageId: `console-email-${randomUUID()}` };
  }
}

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsProvider(console)');

  async send(params: { to: string; body: string }): Promise<ProviderSendResult> {
    this.logger.log(`[SIMULATED SMS] to=${params.to} body="${params.body}"`);
    return { success: true, providerMessageId: `console-sms-${randomUUID()}` };
  }
}

@Injectable()
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('WhatsAppProvider(console)');

  async send(params: { to: string; body: string }): Promise<ProviderSendResult> {
    this.logger.log(`[SIMULATED WHATSAPP] to=${params.to} body="${params.body}"`);
    return { success: true, providerMessageId: `console-whatsapp-${randomUUID()}` };
  }
}
