import { Injectable, NotFoundException } from '@nestjs/common';
import { generateCustomerNumber } from '../common/numbering/numbering.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { customerNumber: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        addresses: true,
        shipments: {
          orderBy: { createdAt: 'desc' },
          include: { items: { select: { id: true, receivedAt: true } } },
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  /** Creates a customer with a server-generated, tenant-sequential customerNumber. */
  async create(tenantId: string, dto: CreateCustomerDto) {
    const customerNumber = await generateCustomerNumber(this.prisma, tenantId);
    return this.prisma.customer.create({
      data: { tenantId, customerNumber, ...dto },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    await this.findById(tenantId, id); // 404s if missing or belongs to another tenant
    return this.prisma.customer.update({
      where: { id },
      data: dto,
    });
  }
}
