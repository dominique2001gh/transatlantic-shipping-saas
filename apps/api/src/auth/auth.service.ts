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
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { customer: { select: { id: true } } },
    });

    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was.
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!tenant || !tenant.isActive) {
        throw new UnauthorizedException('This account\'s organization is not active');
      }
    }

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
