import { Controller, HttpCode, HttpStatus, Body, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { LoginResponseDto } from '@transatlantic/shared';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentMfaStageUserId, RequireMfaStage } from './mfa-stage.decorator';
import { MfaStageGuard } from './mfa-stage.guard';
import { VerifyMfaCodeDto } from './dto/verify-mfa-code.dto';
import { MfaService } from './mfa.service';

/**
 * Email-based staff MFA (2026-10): the pre-session half of the login
 * flow — reachable only with a short-lived `mfaToken` from POST
 * /auth/login (see MfaStageGuard), never with a normal session token.
 * Two routes only: `send` (emails a fresh code — called once right after
 * login, and again for an explicit resend) and `challenge` (verifies the
 * code entered). There is no separate enrollment step; email OTP applies
 * uniformly to every STAFF_ROLES account from their very first login.
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  /**
   * Deliberately stricter than `challenge` below — each call sends a real
   * email, so this is the one route a resend-spam attempt would hit
   * hardest. MfaService.requestOtp's own cooldown is the primary defense;
   * this is defense-in-depth against a client that ignores it.
   */
  @Public()
  @RequireMfaStage('mfa_challenge')
  @UseGuards(MfaStageGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('send')
  async send(@CurrentMfaStageUserId() userId: string): Promise<{ success: true }> {
    await this.mfaService.requestOtp(userId);
    return { success: true };
  }

  @Public()
  @RequireMfaStage('mfa_challenge')
  @UseGuards(MfaStageGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('challenge')
  async challenge(@CurrentMfaStageUserId() userId: string, @Body() dto: VerifyMfaCodeDto): Promise<LoginResponseDto> {
    return this.mfaService.verifyOtp(userId, dto.code);
  }
}
