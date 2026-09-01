"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaHealthIndicator = void 0;
const common_1 = require("@nestjs/common");
const terminus_1 = require("@nestjs/terminus");
const prisma_service_1 = require("../../prisma/prisma.service");
let PrismaHealthIndicator = class PrismaHealthIndicator {
    prisma;
    healthIndicatorService;
    constructor(prisma, healthIndicatorService) {
        this.prisma = prisma;
        this.healthIndicatorService = healthIndicatorService;
    }
    async check(key) {
        const indicator = this.healthIndicatorService.check(key);
        const isHealthy = await this.prisma.isHealthy();
        if (!isHealthy) {
            return indicator.down();
        }
        return indicator.up();
    }
};
exports.PrismaHealthIndicator = PrismaHealthIndicator;
exports.PrismaHealthIndicator = PrismaHealthIndicator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        terminus_1.HealthIndicatorService])
], PrismaHealthIndicator);
//# sourceMappingURL=prisma-health.indicator.js.map