import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleEmailProvider, ConsoleSmsProvider, ConsoleWhatsAppProvider } from './console.providers';
import { EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER } from './provider.types';
import { ResendEmailProvider } from './resend-email.provider';

/**
 * Stage 3H / Website Launch Step 6: one place per channel where the
 * active provider is chosen. EMAIL_PROVIDER defaults to "console"
 * (development); "resend" (production) is the other supported value —
 * see resend-email.provider.ts. SMS_PROVIDER/WHATSAPP_PROVIDER remain
 * "console"-only for now (no real vendor connected yet). Connecting one
 * later means writing one new provider class and adding one `case` per
 * channel here — NotificationsService and every trigger site stay
 * unchanged, since they only ever depend on the provider tokens, never a
 * concrete class. Mirrors StorageModule's STORAGE_DRIVER pattern exactly.
 */
@Module({
  providers: [
    ConsoleEmailProvider,
    ConsoleSmsProvider,
    ConsoleWhatsAppProvider,
    ResendEmailProvider,
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
