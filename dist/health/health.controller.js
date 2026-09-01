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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const terminus_1 = require("@nestjs/terminus");
const prisma_health_indicator_1 = require("./indicators/prisma-health.indicator");
let HealthController = class HealthController {
    health;
    prismaIndicator;
    memory;
    disk;
    constructor(health, prismaIndicator, memory, disk) {
        this.health = health;
        this.prismaIndicator = prismaIndicator;
        this.memory = memory;
        this.disk = disk;
    }
    check() {
        return this.health.check([
            () => this.prismaIndicator.check('database'),
            () => this.memory.checkHeap('memoryHeap', 1024 * 1024 * 1024),
            () => this.disk.checkStorage('diskStorage', {
                path: process.platform === 'win32' ? 'C:\\' : '/',
                thresholdPercent: 0.9,
            }),
        ]);
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)('/live'),
    (0, terminus_1.HealthCheck)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "check", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('health'),
    (0, common_1.Controller)('health'),
    __metadata("design:paramtypes", [terminus_1.HealthCheckService,
        prisma_health_indicator_1.PrismaHealthIndicator,
        terminus_1.MemoryHealthIndicator,
        terminus_1.DiskHealthIndicator])
], HealthController);
//# sourceMappingURL=health.controller.js.map