import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleEmailProvider, ConsoleSmsProvider, ConsoleWhatsAppProvider } from './console.providers';
import { EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER } from './provider.types';

/**
 * Stage 3H: one place per channel where the active provider is chosen —
 * EMAIL_PROVIDER/SMS_PROVIDER/WHATSAPP_PROVIDER env vars each default to
 * "console" (the only implementation that exists today). Connecting a
 * real vendor later (SendGrid, Twilio, Meta's WhatsApp Business Platform)
 * means writing one new provider class and adding one `case` per channel
 * here — NotificationsService and every trigger site stay unchanged,
 * since they only ever depend on the provider tokens, never a concrete
 * class. Mirrors StorageModule's STORAGE_DRIVER pattern exactly.
 */
@Module({
  providers: [
    ConsoleEmailProvider,
    ConsoleSmsProvider,
    ConsoleWhatsAppProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService, console_: ConsoleEmailProvider) => {
        const driver = config.get<string>('EMAIL_PROVIDER', 'console');
        if (driver === 'console') return console_;
        throw new Error(`Unsupported EMAIL_PROVIDER "${driver}" — only "console" is implemented so far.`);
      },
      inject: [ConfigService, ConsoleEmailProvider],
    },
    {
      provide: SMS_PROVIDER,
      useFactory: (config: ConfigService, console_: ConsoleSmsProvider) => {
        const driver = config.get<string>('SMS_PROVIDER', 'console');
        if (driver === 'console') return console_;
        throw new Error(`Unsupported SMS_PROVIDER "${driver}" — only "console" is implemented so far.`);
      },
      inject: [ConfigService, ConsoleSmsProvider],
    },
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (config: ConfigService, console_: ConsoleWhatsAppProvider) => {
        const driver = config.get<string>('WHATSAPP_PROVIDER', 'console');
        if (driver === 'console') return console_;
        throw new Error(`Unsupported WHATSAPP_PROVIDER "${driver}" — only "console" is implemented so far.`);
      },
      inject: [ConfigService, ConsoleWhatsAppProvider],
    },
  ],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER],
})
export class NotificationProvidersModule {}
