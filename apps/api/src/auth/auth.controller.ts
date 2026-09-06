import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthenticatedUser, CustomerEntryPointResponse, LoginResponseDto } from '@transatlantic/shared';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  /** See AuthService.resolveCustomerEntryPoint's own doc comment. */
  @Get('customer-entry-point')
  @AnyAuthenticatedRole()
  customerEntryPoint(@CurrentUser() user: AuthenticatedUser): Promise<CustomerEntryPointResponse> {
    return this.authService.resolveCustomerEntryPoint(user);
  }
}
