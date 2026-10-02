import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_STAGE_KEY } from './mfa-stage.decorator';
import { MfaStageTokenService } from './mfa-stage-token.service';

/**
 * Platform-wide staff MFA (2026-10): the only guard that ever accepts an
 * MfaStageTokenService token — enforces @RequireMfaStage(...) metadata the
 * same way RolesGuard enforces @Roles(...), but deliberately a separate
 * guard/separate token type rather than folding this into JwtAuthGuard,
 * so a stage token and a normal session token can never be confused for
 * each other by a guard that accepts either. Applied per-route via
 * @UseGuards (not globally) — these routes are also @Public() so the
 * global JwtAuthGuard never runs the normal passport-jwt strategy against
 * this payload shape first.
 */
@Injectable()
export class MfaStageGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly mfaStageTokenService: MfaStageTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredStage = this.reflector.getAllAndOverride<'mfa_setup' | 'mfa_challenge' | undefined>(MFA_STAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredStage) {
      // Every route this guard is attached to must declare @RequireMfaStage — fail closed, not open, on a missing declaration.
      throw new UnauthorizedException('This route requires an MFA session token');
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    const userId = await this.mfaStageTokenService.verify(rawToken, requiredStage);
    request.mfaStageUserId = userId;
    return true;
  }
}
