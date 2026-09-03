import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider } from './local-storage.provider';
import { R2StorageProvider } from './r2-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

/**
 * Stage 3G / Website Launch Step 4: the one place a StorageProvider
 * implementation is chosen. `STORAGE_DRIVER` defaults to "local"
 * (development); "r2" (Cloudflare R2, production) is the other supported
 * value. DocumentsService and every controller stay unchanged regardless
 * — they only ever depend on the STORAGE_PROVIDER token, never a concrete
 * class. R2StorageProvider's constructor reads R2_ACCOUNT_ID/
 * R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME itself and throws
 * if any are missing — that only happens if STORAGE_DRIVER=r2 is actually
 * selected, so local dev without R2 credentials is unaffected.
 */
@Module({
  providers: [
    LocalStorageProvider,
    R2StorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: ConfigService, local: LocalStorageProvider, r2: R2StorageProvider) => {
        const driver = config.get<string>('STORAGE_DRIVER', 'local');
        if (driver === 'local') {
          return local;
        }
        if (driver === 'r2') {
          return r2;
        }
        throw new Error(`Unsupported STORAGE_DRIVER "${driver}" — supported values are "local" and "r2".`);
      },
      inject: [ConfigService, LocalStorageProvider, R2StorageProvider],
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
