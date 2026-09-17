import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateCustomerNumber } from '../common/numbering/numbering.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const DUPLICATE_MATCH_SELECT = {
  id: true,
  customerNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

  /**
   * Creates a customer with a server-generated, tenant-sequential
   * customerNumber. Before inserting, checks this tenant (never another
   * tenant's data — see DUPLICATE_MATCH_SELECT's query below) for an
   * existing customer sharing the same email (case-insensitive exact
   * match) or the same phone (exact match). A hit 409s with the matches
   * instead of silently creating or silently merging — this is a warning,
   * not a hard block: `dto.confirmDuplicate` lets a caller who has looked
   * at the matches and confirmed this is genuinely a different person
   * proceed anyway. Deliberately no fuzzy name matching — two unrelated
   * customers who happen to share a common name must never be blocked
   * from both existing.
   */
  async create(tenantId: string, dto: CreateCustomerDto) {
    const { confirmDuplicate, ...customerFields } = dto;
    if (!confirmDuplicate) {
      const duplicates = await this.prisma.customer.findMany({
        where: {
          tenantId,
          OR: [
            { email: { equals: dto.email, mode: 'insensitive' } },
            ...(dto.phone?.trim() ? [{ phone: dto.phone.trim() }] : []),
          ],
        },
        select: DUPLICATE_MATCH_SELECT,
      });
      if (duplicates.length > 0) {
        throw new ConflictException({
          message: 'A customer with this email or phone number already exists.',
          duplicates,
        });
      }
    }

    const customerNumber = await generateCustomerNumber(this.prisma, tenantId);
    return this.prisma.customer.create({
      data: { tenantId, customerNumber, ...customerFields },
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
