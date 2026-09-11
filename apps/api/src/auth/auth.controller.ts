import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AcceptInvitePreview, AuthenticatedUser, CustomerEntryPointResponse, LoginResponseDto } from '@transatlantic/shared';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AcceptInviteDto } from '../staff-invitations/dto/accept-invite.dto';
import { StaffInvitationsService } from '../staff-invitations/staff-invitations.service';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly staffInvitationsService: StaffInvitationsService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * Password recovery (Stage 2): always the same response shape/message
   * regardless of whether `dto.email` matches any account — see
   * AuthService.requestPasswordReset's own doc comment for why this
   * never branches on its result. Throttled (5/min/IP) since this is the
   * one new endpoint an attacker could otherwise use to enumerate emails
   * by timing, or to spam a real user's inbox.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    return { message: "If an account exists for that email, we've sent password reset instructions." };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ success: true }> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    await this.authService.resetPassword(dto.token, dto.password);
    return { success: true };
  }

  /** See AuthService.resolveCustomerEntryPoint's own doc comment. */
  @Get('customer-entry-point')
  @AnyAuthenticatedRole()
  customerEntryPoint(@CurrentUser() user: AuthenticatedUser): Promise<CustomerEntryPointResponse> {
    return this.authService.resolveCustomerEntryPoint(user);
  }

  /**
   * Staff Invitations stage: lets the accept-invite page show who/where
   * (or a clear invalid/expired message) before rendering the password
   * form — see StaffInvitationsService.previewToken's own doc comment.
   * Never reveals anything beyond what's already implied by possessing
   * the token itself.
   */
  @Public()
  @Get('accept-invite/:token')
  previewInvite(@Param('token') token: string): Promise<AcceptInvitePreview> {
    return this.staffInvitationsService.previewToken(token);
  }

  /**
   * Consumes an invitation and creates the employee's User account —
   * the only place a User row is ever created from an invitation. The
   * owner/manager who sent the invite never sees or sets this password.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto): Promise<{ success: true }> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    await this.staffInvitationsService.accept(dto.token, dto.password);
    return { success: true };
  }
}
