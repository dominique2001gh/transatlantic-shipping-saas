import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
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

  // Website Launch cutover: www.talogisticssolutions.com is registered as
  // a second custom domain on this same api service purely to issue a
  // redirect to the canonical apex (talogisticssolutions.com) — Hostinger's
  // own domain-forwarding tool operates on the whole hosted domain, not a
  // single subdomain, so it can't redirect just "www" without also
  // affecting the apex. Every other hostname this service answers to
  // (api.talogisticssolutions.com, the *.up.railway.app temp domain) is
  // completely unaffected — this only ever matches the exact www host.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers.host === 'www.talogisticssolutions.com') {
      res.redirect(301, `https://talogisticssolutions.com${req.originalUrl}`);
      return;
    }
    next();
  });

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
