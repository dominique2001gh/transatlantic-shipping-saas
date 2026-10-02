import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { MfaStage } from './mfa-stage-token.service';

export const MFA_STAGE_KEY = 'mfaStage';

/** Marks a route as requiring a verified MfaStageTokenService token of exactly this stage — see MfaStageGuard. */
export const RequireMfaStage = (stage: MfaStage) => SetMetadata(MFA_STAGE_KEY, stage);

/** Injects the userId MfaStageGuard already resolved from the verified stage token — never trust any other source of identity on these routes. */
export const CurrentMfaStageUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.mfaStageUserId as string;
});
