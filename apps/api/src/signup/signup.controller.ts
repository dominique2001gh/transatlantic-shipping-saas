import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { SignupCheckoutDto } from './dto/signup-checkout.dto';
import { SignupCompanyDto } from './dto/signup-company.dto';
import { SignupOwnerDto } from './dto/signup-owner.dto';
import { StartSignupDto } from './dto/start-signup.dto';
import { SignupService } from './signup.service';

/**
 * AnanseLogix Phase 1: the self-service signup wizard's entire public,
 * unauthenticated surface — no account exists yet at any of these steps,
 * so every route here is @Public() and rate-limited the same way
 * PublicLeadsController is (see LeadsModule's own doc comment for why a
 * module-scoped ThrottlerModule rather than a global guard).
 */
@Controller('public/signup')
@UseGuards(ThrottlerGuard)
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  @Post('start')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@Body() dto: StartSignupDto) {
    return this.signupService.start(dto);
  }

  @Patch(':token/owner')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setOwner(@Param('token') token: string, @Body() dto: SignupOwnerDto) {
    return this.signupService.setOwner(token, dto);
  }

  @Patch(':token/company')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setCompany(@Param('token') token: string, @Body() dto: SignupCompanyDto) {
    return this.signupService.setCompany(token, dto);
  }

  @Post(':token/checkout')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createCheckout(@Param('token') token: string, @Body() dto: SignupCheckoutDto) {
    return this.signupService.createCheckout(token, dto);
  }

  @Get(':token/status')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getStatus(@Param('token') token: string) {
    return this.signupService.getStatus(token);
  }
}
