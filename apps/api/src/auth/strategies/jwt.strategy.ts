import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthenticatedUser, JwtPayload } from '@transatlantic/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs on every authenticated request. Re-checks the user against the
   * database (rather than trusting the JWT payload alone) so a
   * deactivated user or deleted tenant is rejected immediately instead of
   * waiting for the token to expire.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { customer: { select: { id: true } } },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!tenant || !tenant.isActive) {
        throw new UnauthorizedException('Tenant account is not active');
      }
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as AuthenticatedUser['role'],
      tenantId: user.tenantId,
      customerId: user.customer?.id ?? null,
    };
  }
}
