import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser, JwtPayload, LoginResponseDto } from '@transatlantic/shared';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const normalizedEmail = email.toLowerCase().trim();

    // email is unique per tenant, not globally (Stage 2C: the same person
    // may hold independent customer-portal accounts at more than one
    // tenant with the same email). The login form only collects
    // email+password, so every account with this email is a candidate —
    // whichever one's password matches (and whose tenant, if any, is
    // active) is the account that gets logged into. In the overwhelmingly
    // common case (one account per email) this is exactly one candidate,
    // so behavior is unchanged from before.
    const candidates = await this.prisma.user.findMany({
      where: { email: normalizedEmail },
      include: { customer: { select: { id: true } } },
    });

    let tenantInactiveMatch: (typeof candidates)[number] | null = null;

    for (const user of candidates) {
      if (!user.isActive) continue;

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) continue;

      if (user.tenantId) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
        if (!tenant || !tenant.isActive) {
          tenantInactiveMatch = user;
          continue;
        }
      }

      return this.buildLoginResponse(user);
    }

    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was. A tenant-inactive match (correct password, but the
    // organization itself is deactivated) gets its own specific message,
    // matching the pre-Stage-2C single-account behavior.
    if (tenantInactiveMatch) {
      throw new UnauthorizedException("This account's organization is not active");
    }
    throw new UnauthorizedException('Invalid email or password');
  }

  private async buildLoginResponse(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId: string | null;
    customer: { id: string } | null;
  }): Promise<LoginResponseDto> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as AuthenticatedUser['role'],
      tenantId: user.tenantId,
      customerId: user.customer?.id ?? null,
    };

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: authenticatedUser.role,
      tenantId: user.tenantId,
      customerId: authenticatedUser.customerId,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d'),
      }),
      user: authenticatedUser,
    };
  }

  static async hashPassword(plainTextPassword: string, saltRounds = 10): Promise<string> {
    return bcrypt.hash(plainTextPassword, saltRounds);
  }
}
