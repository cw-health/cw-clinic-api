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
exports.EnvironmentVariables = exports.NodeEnv = void 0;
exports.validateEnvironment = validateEnvironment;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
var NodeEnv;
(function (NodeEnv) {
    NodeEnv["Development"] = "development";
    NodeEnv["Test"] = "test";
    NodeEnv["Production"] = "production";
})(NodeEnv || (exports.NodeEnv = NodeEnv = {}));
class EnvironmentVariables {
    NODE_ENV = NodeEnv.Development;
    PORT = '3000';
    DATABASE_URL;
    CORS_ORIGINS;
    THROTTLE_TTL_MS = 60000;
    THROTTLE_LIMIT = 100;
    LOG_LEVEL = 'info';
    API_DOCS_ENABLED = 'true';
}
exports.EnvironmentVariables = EnvironmentVariables;
__decorate([
    (0, class_validator_1.IsIn)([NodeEnv.Development, NodeEnv.Test, NodeEnv.Production]),
    __metadata("design:type", String)
], EnvironmentVariables.prototype, "NODE_ENV", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Object)
], EnvironmentVariables.prototype, "PORT", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], EnvironmentVariables.prototype, "DATABASE_URL", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], EnvironmentVariables.prototype, "CORS_ORIGINS", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1000),
    __metadata("design:type", Object)
], EnvironmentVariables.prototype, "THROTTLE_TTL_MS", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], EnvironmentVariables.prototype, "THROTTLE_LIMIT", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    __metadata("design:type", Object)
], EnvironmentVariables.prototype, "LOG_LEVEL", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['true', 'false']),
    __metadata("design:type", Object)
], EnvironmentVariables.prototype, "API_DOCS_ENABLED", void 0);
function validateEnvironment(config) {
    const validatedConfig = (0, class_transformer_1.plainToInstance)(EnvironmentVariables, config, {
        enableImplicitConversion: true,
    });
    const errors = (0, class_validator_1.validateSync)(validatedConfig, { skipMissingProperties: false });
    if (errors.length > 0) {
        const message = errors
            .map((error) => Object.values(error.constraints ?? {}).join(', '))
            .join('; ');
        throw new Error(`Environment validation failed: ${message}`);
    }
    return validatedConfig;
}
//# sourceMappingURL=env.validation.js.map