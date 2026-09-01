import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true preserves the exact request bytes on req.rawBody
  // alongside Nest's normal JSON-parsed req.body for every route — needed
  // by /webhooks/stripe (Stage 3F) to verify Stripe's signature, which is
  // computed over the exact bytes Stripe sent, not a reserialized JSON
  // object. Every other route is unaffected; this only adds a buffer
  // Nest wouldn't otherwise retain.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3000');
  app.enableCors({
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
   
  console.log(`Transatlantic API listening on http://localhost:${port}`);
}

bootstrap();
