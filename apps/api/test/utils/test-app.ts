import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

/**
 * Boots the real Nest application (real AppModule, real PrismaService
 * against the dev database configured in apps/api/.env) with the same
 * global pipes main.ts applies, so e2e tests exercise the exact
 * request-handling pipeline production traffic goes through. `rawBody:
 * true` matches main.ts's own bootstrap option (Stage 3F) — without it,
 * `req.rawBody` would be undefined here even though it's always populated
 * in the real app, silently breaking any e2e test of the Stripe webhook's
 * signature verification (which reads req.rawBody, not req.body).
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
