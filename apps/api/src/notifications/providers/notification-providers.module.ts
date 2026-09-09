import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleEmailProvider, ConsoleSmsProvider, ConsoleWhatsAppProvider } from './console.providers';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER } from './provider.types';
import { ResendEmailProvider } from './resend-email.provider';

/**
 * Stage 3H / Website Launch Step 6: one place per channel where the
 * active provider is chosen. EMAIL_PROVIDER defaults to "console"
 * (development); "resend" (production) is the other supported value —
 * see resend-email.provider.ts. SMS_PROVIDER remains "console"-only for
 * now (no real vendor connected yet). Connecting one later means writing
 * one new provider class and adding one `case` per channel here —
 * NotificationsService and every trigger site stay unchanged, since they
 * only ever depend on the provider tokens, never a concrete class.
 * Mirrors StorageModule's STORAGE_DRIVER pattern exactly.
 *
 * WhatsApp Integration (Stage 4C) Phase 1: WHATSAPP_PROVIDER now also
 * supports "meta" (MetaWhatsAppProvider, real delivery via Meta's Cloud
 * API) alongside "console" — see that provider's own doc comment.
 * Defaults to "console" so no environment that hasn't explicitly opted in
 * (including local dev/test) ever attempts a real send.
 */
@Module({
  providers: [
    ConsoleEmailProvider,
    ConsoleSmsProvider,
    ConsoleWhatsAppProvider,
    ResendEmailProvider,
    MetaWhatsAppProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService, console_: ConsoleEmailProvider, resend: ResendEmailProvider) => {
        const driver = config.get<string>('EMAIL_PROVIDER', 'console');
        if (driver === 'console') return console_;
        if (driver === 'resend') return resend;
        throw new Error(`Unsupported EMAIL_PROVIDER "${driver}" — supported values are "console" and "resend".`);
      },
      inject: [ConfigService, ConsoleEmailProvider, ResendEmailProvider],
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
      useFactory: (config: ConfigService, console_: ConsoleWhatsAppProvider, meta: MetaWhatsAppProvider) => {
        const driver = config.get<string>('WHATSAPP_PROVIDER', 'console');
        if (driver === 'console') return console_;
        if (driver === 'meta') return meta;
        throw new Error(`Unsupported WHATSAPP_PROVIDER "${driver}" — supported values are "console" and "meta".`);
      },
      inject: [ConfigService, ConsoleWhatsAppProvider, MetaWhatsAppProvider],
    },
  ],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER],
})
export class NotificationProvidersModule {}
