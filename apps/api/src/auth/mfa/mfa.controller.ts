import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { LoginResponseDto, MfaSetupResponse } from '@transatlantic/shared';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentMfaStageUserId, RequireMfaStage } from './mfa-stage.decorator';
import { MfaStageGuard } from './mfa-stage.guard';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { VerifyMfaCodeDto } from './dto/verify-mfa-code.dto';
import { MfaService } from './mfa.service';

/**
 * Platform-wide staff MFA (2026-10): the pre-session half of the MFA flow
 * — reachable only with a short-lived `mfaToken` from POST /auth/login
 * (see MfaStageGuard), never with a normal session token. Lives under
 * /auth (not /users) for the same reason accept-invite/forgot-password
 * do: these routes exist before a real authenticated session exists.
 * Authenticated factor-management routes (status/replace) are on
 * UsersController instead — see that file's own doc comment.
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  @Public()
  @RequireMfaStage('mfa_setup')
  @UseGuards(MfaStageGuard)
  @Post('setup')
  beginSetup(@CurrentMfaStageUserId() userId: string): Promise<MfaSetupResponse> {
    return this.mfaService.beginSetup(userId);
  }

  @Public()
  @RequireMfaStage('mfa_setup')
  @UseGuards(MfaStageGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('setup/verify')
  async verifySetup(
    @CurrentMfaStageUserId() userId: string,
    @Body() dto: VerifyMfaCodeDto,
  ): Promise<LoginResponseDto & { recoveryCodes: string[] }> {
    return this.mfaService.verifySetup(userId, dto.code);
  }

  @Public()
  @RequireMfaStage('mfa_challenge')
  @UseGuards(MfaStageGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('challenge')
  async challenge(@CurrentMfaStageUserId() userId: string, @Body() dto: MfaChallengeDto): Promise<LoginResponseDto> {
    return this.mfaService.challenge(userId, dto.code, dto.recoveryCode);
  }
}
