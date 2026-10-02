import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export type MfaStage = 'mfa_setup' | 'mfa_challenge';

export interface MfaStageTokenPayload {
  sub: string;
  stage: MfaStage;
}

/** How long the window between "password verified" and "MFA step completed" stays open — short by design, same reasoning as every other short-lived token in this codebase (forgot-password's 30 minutes, invitations' 7 days — this is the tightest of the three since it's a single uninterrupted login attempt, not something a person checks email for). */
const MFA_STAGE_TOKEN_TTL = '10m';

/**
 * Platform-wide staff MFA (2026-10): issues and verifies the short-lived
 * token a client holds between "password verified" and "MFA step
 * completed" — see AuthService.login's own doc comment for why this is a
 * structurally distinct token type, not a less-privileged version of the
 * normal access token.
 *
 * Deliberately NOT validated by the normal JwtStrategy/JwtAuthGuard: this
 * payload shape (`stage`, no `role`/`tenantId`/`mfa`) would fail every
 * downstream guard anyway, but the two /auth/mfa/* routes that accept it
 * are marked @Public() specifically so the global JwtAuthGuard never even
 * attempts to run the normal strategy against it — MfaStageGuard (see
 * that file) is the only thing that ever verifies one. Signed with the
 * same JWT_SECRET as a normal session token (no new secret to manage) —
 * safe because the `stage` claim and this service's own verification
 * method are what prevent a stage token from ever being accepted as a
 * normal session, not secret separation.
 */
@Injectable()
export class MfaStageTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async issue(userId: string, stage: MfaStage): Promise<string> {
    const payload: MfaStageTokenPayload = { sub: userId, stage };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: MFA_STAGE_TOKEN_TTL,
    });
  }

  /** Throws UnauthorizedException if the token is missing, invalid/expired, or isn't tagged for `expectedStage`. */
  async verify(rawToken: string | undefined, expectedStage: MfaStage): Promise<string> {
    if (!rawToken) {
      throw new UnauthorizedException('Missing MFA session token');
    }
    let payload: MfaStageTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<MfaStageTokenPayload>(rawToken, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Your MFA session has expired — please log in again');
    }
    if (payload.stage !== expectedStage || !payload.sub) {
      throw new UnauthorizedException('Invalid MFA session token');
    }
    return payload.sub;
  }
}
