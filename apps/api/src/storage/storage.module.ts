import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider } from './local-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

/**
 * Stage 3G: the one place a StorageProvider implementation is chosen.
 * `STORAGE_DRIVER` defaults to "local" (development). Adding a cloud
 * provider later means writing e.g. `s3-storage.provider.ts` and adding
 * one case below — DocumentsService and every controller stay unchanged,
 * since they only ever depend on the STORAGE_PROVIDER token, never a
 * concrete class.
 */
@Module({
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: ConfigService, local: LocalStorageProvider) => {
        const driver = config.get<string>('STORAGE_DRIVER', 'local');
        if (driver === 'local') {
          return local;
        }
        throw new Error(
          `Unsupported STORAGE_DRIVER "${driver}" — only "local" is implemented so far. Cloud object-storage providers (S3/GCS) are a later stage.`,
        );
      },
      inject: [ConfigService, LocalStorageProvider],
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
